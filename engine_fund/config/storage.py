"""Storage configuration for simulation results."""

import os
from enum import Enum
from pathlib import Path
from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings


class StorageType(str, Enum):
    """Available storage backend types."""
    FILE = "file"
    POSTGRES = "postgres"


class StorageSettings(BaseSettings):
    """
    Configuration for storage backends.
    
    Environment variables:
        STORAGE_TYPE: Type of storage backend (file or postgres). Default: file
        STORAGE_FILE_DIR: Directory for file-based storage. Default: reports/simulation_tasks
        STORAGE_POSTGRES_URL: PostgreSQL connection URL. Required if type=postgres
        STORAGE_POSTGRES_POOL_SIZE: Connection pool size. Default: 5
        STORAGE_POSTGRES_MAX_OVERFLOW: Max overflow connections. Default: 10
    """
    
    # Storage backend selection
    type: StorageType = Field(
        default=StorageType.FILE,
        description="Storage backend type"
    )
    
    # File-based storage settings
    file_dir: Path = Field(
        default=Path("reports/simulation_tasks"),
        description="Directory for file-based storage"
    )
    
    # PostgreSQL storage settings
    postgres_url: Optional[str] = Field(
        default=None,
        description="PostgreSQL connection URL (e.g., postgresql://user:pass@host:5432/db)"
    )
    postgres_pool_size: int = Field(
        default=5,
        description="Database connection pool size"
    )
    postgres_max_overflow: int = Field(
        default=10,
        description="Maximum overflow connections beyond pool_size"
    )
    
    class Config:
        env_prefix = "STORAGE_"
        case_sensitive = False

    def validate_postgres_settings(self) -> None:
        """Validate that postgres_url is set when using postgres backend."""
        if self.type == StorageType.POSTGRES and not self.postgres_url:
            raise ValueError(
                "STORAGE_POSTGRES_URL must be set when STORAGE_TYPE=postgres"
            )


# Global singleton instance
_settings: Optional[StorageSettings] = None


def get_storage_settings() -> StorageSettings:
    """
    Get storage settings singleton.
    
    Settings are loaded once and cached. Environment variables are read
    on first call. To reload settings, call reset_storage_settings() first.
    
    Returns:
        StorageSettings instance
    """
    global _settings
    if _settings is None:
        _settings = StorageSettings()
        _settings.validate_postgres_settings()
    return _settings


def reset_storage_settings() -> None:
    """Reset storage settings singleton. Useful for testing."""
    global _settings
    _settings = None


__all__ = ["StorageType", "StorageSettings", "get_storage_settings", "reset_storage_settings"]
