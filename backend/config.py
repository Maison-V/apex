from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    twelve_data_api_key: str = ""
    debug: bool = False
    host: str = "0.0.0.0"
    port: int = 8000

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

settings = Settings()
