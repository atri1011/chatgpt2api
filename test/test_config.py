import json
import tempfile
import unittest
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
ROOT_CONFIG_FILE = ROOT_DIR / "config.json"


class ConfigLoadingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._created_root_config = False
        if not ROOT_CONFIG_FILE.exists():
            ROOT_CONFIG_FILE.write_text(json.dumps({"auth-key": "test-auth"}), encoding="utf-8")
            cls._created_root_config = True

        from services import config as config_module

        cls.config_module = config_module

    @classmethod
    def tearDownClass(cls) -> None:
        if cls._created_root_config and ROOT_CONFIG_FILE.exists():
            ROOT_CONFIG_FILE.unlink()

    def test_load_settings_ignores_directory_config_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            base_dir = Path(tmp_dir)
            data_dir = base_dir / "data"
            config_dir = base_dir / "config.json"
            os_auth_key = "env-auth"

            config_dir.mkdir()

            module = self.config_module
            old_base_dir = module.BASE_DIR
            old_data_dir = module.DATA_DIR
            old_config_file = module.CONFIG_FILE
            old_env_auth_key = module.os.environ.get("CHATGPT2API_AUTH_KEY")
            try:
                module.BASE_DIR = base_dir
                module.DATA_DIR = data_dir
                module.CONFIG_FILE = config_dir
                module.os.environ["CHATGPT2API_AUTH_KEY"] = os_auth_key

                settings = module._load_settings()

                self.assertEqual(settings.auth_key, os_auth_key)
                self.assertEqual(settings.refresh_account_interval_minute, 5)
            finally:
                module.BASE_DIR = old_base_dir
                module.DATA_DIR = old_data_dir
                module.CONFIG_FILE = old_config_file
                if old_env_auth_key is None:
                    module.os.environ.pop("CHATGPT2API_AUTH_KEY", None)
                else:
                    module.os.environ["CHATGPT2API_AUTH_KEY"] = old_env_auth_key

    def test_image_provider_normalization_and_newapi_env_only(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            base_dir = Path(tmp_dir)
            data_dir = base_dir / "data"
            config_file = base_dir / "config.json"
            config_file.write_text(json.dumps({"auth-key": "test-auth", "image_provider": "bogus"}), encoding="utf-8")

            module = self.config_module
            old_data_dir = module.DATA_DIR
            old_env_provider = module.os.environ.get("CHATGPT2API_IMAGE_PROVIDER")
            old_env_base_url = module.os.environ.get("CHATGPT2API_NEWAPI_BASE_URL")
            old_env_api_key = module.os.environ.get("CHATGPT2API_NEWAPI_API_KEY")
            try:
                module.DATA_DIR = data_dir
                module.os.environ["CHATGPT2API_IMAGE_PROVIDER"] = "newapi"
                module.os.environ["CHATGPT2API_NEWAPI_BASE_URL"] = "https://newapi.example.test/v1"
                module.os.environ["CHATGPT2API_NEWAPI_API_KEY"] = "sk-test"

                store = module.ConfigStore(config_file)

                self.assertEqual(store.image_provider, "chatgpt_web")
                updated = store.update({
                    "image_provider": "newapi",
                    "newapi_image_api_key": "should-not-persist",
                    "newapi_image_base_url": "https://should-not-persist.test",
                    "newapi_image": {"api_key_configured": False},
                })

                self.assertEqual(updated["image_provider"], "newapi")
                self.assertTrue(updated["newapi_image"]["base_url_configured"])
                self.assertTrue(updated["newapi_image"]["api_key_configured"])
                saved = json.loads(config_file.read_text(encoding="utf-8"))
                self.assertEqual(saved["image_provider"], "newapi")
                self.assertNotIn("newapi_image_api_key", saved)
                self.assertNotIn("newapi_image_base_url", saved)
                self.assertNotIn("newapi_image", saved)
            finally:
                module.DATA_DIR = old_data_dir
                for key, value in {
                    "CHATGPT2API_IMAGE_PROVIDER": old_env_provider,
                    "CHATGPT2API_NEWAPI_BASE_URL": old_env_base_url,
                    "CHATGPT2API_NEWAPI_API_KEY": old_env_api_key,
                }.items():
                    if value is None:
                        module.os.environ.pop(key, None)
                    else:
                        module.os.environ[key] = value

    def test_load_dotenv_file_does_not_override_existing_env(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            env_file = Path(tmp_dir) / ".env"
            env_file.write_text(
                "\n".join([
                    "CHATGPT2API_NEWAPI_BASE_URL=https://newapi.local.test",
                    "CHATGPT2API_NEWAPI_API_KEY='sk-local'",
                    "CHATGPT2API_NEWAPI_IMAGE_MODEL=\"gpt-image-2\"",
                    "CHATGPT2API_NEWAPI_TIMEOUT_SEC=180",
                    "CHATGPT2API_AUTH_KEY=env-login-key",
                ]),
                encoding="utf-8",
            )

            module = self.config_module
            keys = [
                "CHATGPT2API_NEWAPI_BASE_URL",
                "CHATGPT2API_NEWAPI_API_KEY",
                "CHATGPT2API_NEWAPI_IMAGE_MODEL",
                "CHATGPT2API_NEWAPI_TIMEOUT_SEC",
            ]
            old_values = {key: module.os.environ.get(key) for key in keys}
            old_env_auth_key = module.os.environ.get("CHATGPT2API_AUTH_KEY")
            try:
                for key in keys:
                    module.os.environ.pop(key, None)
                module.os.environ.pop("CHATGPT2API_AUTH_KEY", None)
                module.os.environ["CHATGPT2API_NEWAPI_TIMEOUT_SEC"] = "300"

                module._load_dotenv_file(env_file)

                self.assertEqual(module.os.environ["CHATGPT2API_NEWAPI_BASE_URL"], "https://newapi.local.test")
                self.assertEqual(module.os.environ["CHATGPT2API_NEWAPI_API_KEY"], "sk-local")
                self.assertEqual(module.os.environ["CHATGPT2API_NEWAPI_IMAGE_MODEL"], "gpt-image-2")
                self.assertEqual(module.os.environ["CHATGPT2API_NEWAPI_TIMEOUT_SEC"], "300")
                self.assertNotIn("CHATGPT2API_AUTH_KEY", module.os.environ)
            finally:
                for key, value in old_values.items():
                    if value is None:
                        module.os.environ.pop(key, None)
                    else:
                        module.os.environ[key] = value
                if old_env_auth_key is None:
                    module.os.environ.pop("CHATGPT2API_AUTH_KEY", None)
                else:
                    module.os.environ["CHATGPT2API_AUTH_KEY"] = old_env_auth_key


if __name__ == "__main__":
    unittest.main()
