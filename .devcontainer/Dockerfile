FROM mcr.microsoft.com/devcontainers/python:1-3.12-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        curl \
        ffmpeg \
        git \
        libffi-dev \
        libssl-dev \
        pkg-config \
        ripgrep \
    && rm -rf /var/lib/apt/lists/*
