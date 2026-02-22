# Docker 部署指南 🐳

本文档介绍了如何使用 Docker 和 Docker Compose 快速部署流光 (PrismFlowAgent)。

## 1. 前置要求

在开始之前，请确保您的系统中已安装：
- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/)

## 2. 环境配置

1.  克隆项目：
    ```bash
    git clone https://github.com/justlovemaki/PrismFlowAgent.git
    cd PrismFlowAgent
    ```

2.  准备环境变量文件：
    复制 `.env.example` 为 `.env` 并填写必要的配置（如 AI API Key、数据库路径等）。
    ```bash
    cp .env.example .env
    ```

    > **注意**：在 Docker 环境中，`DATABASE_PATH` 默认配置为 `/app/data/database.sqlite`。建议保持此默认值以确保数据持久化卷挂载正确。

## 3. 使用 Docker Compose 部署 (推荐)

使用 Docker Compose 是最简单的部署方式。项目已包含 `docker-compose.yml` 文件。

### 启动服务

```bash
docker-compose up -d
```

此命令将：
- 构建镜像（如果尚未构建）。
- 启动容器并将容器的 3000 端口映射到宿主机的 3000 端口。
- 挂载 `./data` 目录到容器内的 `/app/data`，实现数据持久化。
- 挂载 `.env` 文件到容器。

### 查看日志

```bash
docker-compose logs -f
```

### 停止并移除容器

```bash
docker-compose down
```

## 4. 使用 Docker 命令手动部署

如果您不想使用 Docker Compose，也可以手动构建和运行镜像。

### 构建镜像

```bash
docker build -t prism-flow-agent .
```

### 运行容器

```bash
docker run -d \
  --name PrismFlowAgent \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  --env-file .env \
  --restart always \
  prism-flow-agent
```

## 5. 数据持久化

容器内部的 `/app/data` 目录用于存储 SQLite 数据库和缓存文件。
在 `docker-compose.yml` 中，该目录已挂载到宿主机的 `./data` 目录。

请确保宿主机上的 `./data` 目录具有写入权限。

## 6. 常用维护命令

### 更新到最新版本

```bash
git pull
docker-compose up -d --build
```

### 进入容器内部

```bash
docker exec -it PrismFlowAgent /bin/sh
```

## 7. 注意事项

- **端口冲突**：如果 3000 端口已被占用，可以修改 `.env` 文件中的 `PORT` 变量或修改 `docker-compose.yml` 中的端口映射。
- **时区配置**：`docker-compose.yml` 默认设置时区为 `Asia/Shanghai`。
- **构建速度**：构建镜像时会安装前端和后端的依赖并进行构建，这可能需要几分钟时间，具体取决于您的网络状况。
