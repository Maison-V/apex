import os
from dotenv import load_dotenv

load_dotenv()

class Settings:
    twelve_data_api_key: str = os.getenv("TWELVE_DATA_API_KEY", "")
    debug: bool = os.getenv("DEBUG", "true").lower() == "true"
    host: str = os.getenv("HOST", "0.0.0.0")
    port: int = int(os.getenv("PORT", "8000"))

settings = Settings()
