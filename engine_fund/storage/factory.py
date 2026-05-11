"""Factory for creating storage backend instances."""

import logging
from typing import Optional

from ..storage import StorageBackend
from ..storage.file_backend import FileStorageBackend
from ..config.storage import get_storage_settings, StorageType

logger = logging.getLogger(__name__)

# Global storage backend singleton
_storage_backend: Optional[StorageBackend] = None


def get_storage_backend() -> StorageBackend:
    """
    Get the configured storage backend instance.
    
    Creates and caches a singleton based on STORAGE_TYPE environment variable:
    - file: FileStorageBackend (default)
    - postgres: PostgresStorageBackend
    
    Returns:
        StorageBackend instance
        
    Raises:
        ValueError: If storage type is invalid or required settings are missing
    """
    global _storage_backend
    
    if _storage_backend is not None:
        return _storage_backend
    
    settings = get_storage_settings()
    
    if settings.type == StorageType.FILE:
        logger.info(f"Initializing FileStorageBackend with dir: {settings.file_dir}")
        _storage_backend = FileStorageBackend(storage_dir=settings.file_dir)
    
    elif settings.type == StorageType.POSTGRES:
        logger.info("Initializing PostgresStorageBackend")
        # Import only when needed to avoid requiring postgres dependencies
        try:
            from quant.storage.postgres_backend import PostgresStorageBackend
            _storage_backend = PostgresStorageBackend(
                connection_url=settings.postgres_url,
                pool_size=settings.postgres_pool_size,
                max_overflow=settings.postgres_max_overflow,
            )
        except ImportError as e:
            raise ImportError(
                "PostgreSQL storage backend requires additional dependencies. "
                "Install with: pip install sqlalchemy psycopg2-binary"
            ) from e
    
    else:
        raise ValueError(f"Unknown storage type: {settings.type}")
    
    return _storage_backend


def reset_storage_backend() -> None:
    """Reset storage backend singleton. Useful for testing."""
    global _storage_backend
    _storage_backend = None


__all__ = ["get_storage_backend", "reset_storage_backend"]
