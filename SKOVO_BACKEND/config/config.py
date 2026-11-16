import os
import configparser


class BaseConfig:
    ROOT_DIR = os.getcwd()
    LOG_DIR = os.path.join(ROOT_DIR, "logs")
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        'pool_pre_ping': True,
        'pool_recycle': 280,
    }


class Development(BaseConfig):
    config = configparser.ConfigParser()
    config_file_path = os.path.join(BaseConfig.ROOT_DIR, "config", "dev.ini")
    config.read(config_file_path)

    SQLALCHEMY_DATABASE_URI = config.get(
        "server", "sqlalchemy_database_uri", fallback=""
    )


class Production(BaseConfig):
    config = configparser.ConfigParser()
    config_file_path = os.path.join(BaseConfig.ROOT_DIR, "config", "prod.ini")
    config.read(config_file_path)

    SQLALCHEMY_DATABASE_URI = config.get(
        "server", "sqlalchemy_database_uri", fallback=""
    )


class UAT(BaseConfig):
    config = configparser.ConfigParser()
    config_file_path = os.path.join(BaseConfig.ROOT_DIR, "config", "uat.ini")
    config.read(config_file_path)

    SQLALCHEMY_DATABASE_URI = config.get(
        "server", "sqlalchemy_database_uri", fallback=""
    )
