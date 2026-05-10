import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT_DIR = Path(__file__).resolve().parents[1]
ROOT_CONFIG_FILE = ROOT_DIR / "config.json"


class ConfigLoadingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._old_env_auth_key = os.environ.get("CHATGPT2API_AUTH_KEY")
        os.environ["CHATGPT2API_AUTH_KEY"] = "test-auth"
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
        if cls._old_env_auth_key is None:
            os.environ.pop("CHATGPT2API_AUTH_KEY", None)
        else:
            os.environ["CHATGPT2API_AUTH_KEY"] = cls._old_env_auth_key

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

    def test_numbered_image_api_endpoints_are_sorted_and_exposed(self) -> None:
        module = self.config_module
        with mock.patch.dict(module.os.environ, {
            "CHATGPT2API_IMAGE_API_2_BASE_URL": "https://node2.example.com/",
            "CHATGPT2API_IMAGE_API_2_KEY": "sk-node-2",
            "CHATGPT2API_IMAGE_API_1_BASE_URL": "https://node1.example.com",
            "CHATGPT2API_IMAGE_API_1_KEY": "sk-node-1",
        }, clear=False):
            endpoints, error = module._resolve_image_api_endpoints()
        self.assertEqual(error, None)
        self.assertEqual([item.name for item in endpoints], [
            "CHATGPT2API_IMAGE_API_1",
            "CHATGPT2API_IMAGE_API_2",
        ])
        self.assertEqual(endpoints[0].base_url, "https://node1.example.com")
        self.assertEqual(endpoints[1].api_key, "sk-node-2")

    def test_numbered_image_api_endpoints_require_matching_key(self) -> None:
        module = self.config_module
        with mock.patch.dict(module.os.environ, {
            "CHATGPT2API_IMAGE_API_1_BASE_URL": "https://node1.example.com",
        }, clear=True):
            endpoints, error = module._resolve_image_api_endpoints()
        self.assertEqual(endpoints, [])
        self.assertIn("CHATGPT2API_IMAGE_API_1_KEY is required", str(error))


if __name__ == "__main__":
    unittest.main()
