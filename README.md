# Checkmate - Test Case Management Tool

Welcome to Checkmate! 🎉

This Test Case Management Tool is designed to address the challenges faced by teams in managing and executing test cases with the highest level of availability and reliability. It aims to streamline the testing process, offering robust features, seamless integrations, migration, and user-friendly and intuitive design.

## 📌 Features

- ✅ Effortlessly manage test cases and categorize them based on labels, squads, sections, priority, and more.
- ✅ Create test runs, update statuses, track progress, download reports, and analyze historical data.
- ✅ Provides integration APIs to seamlessly connect with your testing pipeline.
- ✅ Role-Based Access Control (RBAC) for secure and controlled usage.
- ✅ Integrated Google Login for a hassle-free authentication experience.

## 🔗 Quick Links

- [Detailed Documentation](https://checkmate.dreamhorizon.org/)
- [Installation Guide](https://checkmate.dreamhorizon.org/docs/project/setup)
- [Cloud Deployment (AWS/GCP)](https://checkmate.dreamhorizon.org/docs/project/cloud-deployment)
- [Product Guide](https://checkmate.dreamhorizon.org/docs/guides/projects)
- [API Documentation](https://checkmate.dreamhorizon.org/docs/guides/api/)
- [Connect with us on discord](https://discord.gg/wBQXeYAKNc)

## 📦 Installation

### 🚀 One-Line Install (Easiest)

Install Checkmate with a single command:

```sh
curl -fsSL https://raw.githubusercontent.com/dream-horizon-org/checkmate/master/bootstrap.sh | bash
```

Or using wget:

```sh
wget -qO- https://raw.githubusercontent.com/dream-horizon-org/checkmate/master/bootstrap.sh | bash
```

This will download and run the interactive installer that walks you through everything.

### Alternative: Direct Install Script

If you prefer to download the script first:

```sh
# Download
curl -fsSL https://raw.githubusercontent.com/dream-horizon-org/checkmate/master/install.sh -o install.sh
chmod +x install.sh

# Run
./install.sh
```

Or clone the repository first:

```sh
git clone git@github.com:dream-horizon-org/checkmate.git
cd checkmate
./install.sh
```

**The script will:**
- ✅ Check and install prerequisites (Git, Node.js v20, Yarn, Docker)
- ✅ Clone the repository (if needed)
- ✅ **Guide you through Google OAuth setup** with step-by-step instructions
- ✅ Optionally open Google Cloud Console in your browser
- ✅ Prompt for OAuth credentials interactively
- ✅ Automatically configure your `.env` file
- ✅ Generate secure session secrets
- ✅ Install all dependencies
- ✅ Set up Docker containers and seed database

**No manual configuration needed!** The script walks you through each step.

### Manual Installation

#### Pre-requisites

1. Docker Desktop
2. Node.js (v18.x or higher)
3. Yarn
4. Google OAuth Application

#### Setup Steps

1. Clone the repository:
   ```sh
   git clone git@github.com:dream-horizon-org/checkmate.git
   cd checkmate
   ```
2. Create an .env file at root level, based on .env.example.
   ```sh
   cp .env.example .env
   ```
3. Install dependencies
   ```sh
   yarn install
   ```
4. Set up the application and database:
   ```sh
   yarn docker:setup
   ```
   - Create both the application and database containers using Docker.
   - Seed the database with initial data.
5. App will be started on http://localhost:3000


### ☁️ Production Deployment (AWS/GCP)

Deploy Checkmate to production on AWS or GCP. See our [Cloud Deployment Guide](https://checkmate.dreamhorizon.org/docs/project/cloud-deployment) for detailed instructions.

**Quick Overview:**

| Platform | Options |
|----------|---------|
| **AWS** | EC2 + Docker, ECS (Fargate), RDS for MySQL |
| **GCP** | Compute Engine, Cloud Run, Cloud SQL |

**Key Steps:**
1. Configure production Google OAuth credentials
2. Set up managed database (RDS/Cloud SQL) or use Docker MySQL
3. Deploy with Docker Compose or container service
4. Configure SSL with Let's Encrypt or cloud provider certificates
5. Set up monitoring and backups

```bash
# Example: Deploy on any Linux server with Docker
git clone https://github.com/dream-horizon-org/checkmate.git
cd checkmate
cp .env.example .env  # Configure production values
docker-compose up -d --build
```

### 📖 API Documentation

[Postman](https://documenter.getpostman.com/view/23217307/2sAYXFgwRt) collection of APIs is currently available, comprehensive documentation is in progress.

### 🤖 MCP Server

Checkmate includes an [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that allows AI assistants like Claude to interact with your Checkmate instance programmatically.

**Features:**
- ✅ Full API access through AI assistants
- ✅ Manage tests, projects, and runs via natural language
- ✅ Update test statuses and track progress
- ✅ Query test history and analytics
- ✅ TypeScript-based with full type safety
- ✅ Docker support for production deployment

**Local Development Setup:**

For local development, start both the app and MCP server together:

```bash
# Start Checkmate app and MCP server together
yarn dev:with-mcp
```

Or run separately:

```bash
# Terminal 1: Start Checkmate app
yarn dev

# Terminal 2: Start MCP server
yarn mcp:dev
```

**Prerequisites:**
1. Get your API token from Checkmate UI (User Settings → API Tokens → Generate Token)
2. Update `mcp-server/.env` with your token:
   ```env
   CHECKMATE_API_BASE=http://localhost:3000
   CHECKMATE_API_TOKEN=your-api-token-here
   ```

**Docker Deployment:**

```bash
# Start all services including MCP server
docker-compose up -d

# Check MCP server status
docker-compose ps checkmate-mcp

# View MCP server logs
docker-compose logs -f checkmate-mcp
```

**Documentation:**
- [MCP Server API Reference](https://checkmate.dreamhorizon.org/docs/guides/api/mcp-server) - Complete API reference
- [MCP Tools Guide](https://checkmate.dreamhorizon.org/docs/guides/api/mcp-tools) - Tool usage examples
- [Docker Deployment](https://checkmate.dreamhorizon.org/docs/project/mcp-docker) - Production deployment with Docker

### ⚙️ TechStack Used:

- <span style="display: flex; align-items: center;">
  <img src="app/assets/remix.png" alt="Remix" style="width:16px; height:auto; margin-right:5px;"> 
  <a href="https://remix.run/" target="_blank">Remix</a>
  </span>

- <span style="display: flex; align-items: center;">
  <img src="app/assets/drizzle.png" alt="Drizzle" style="width:16px; height:auto; margin-right:5px;"> 
  <a href="https://orm.drizzle.team/" target="_blank">Drizzle</a>
  </span>

- <span style="display: flex; align-items: center;">
  <img src="app/assets/mysql.png" alt="MySQL" style="width:16px; height:auto; margin-right:5px;"> 
  <a href="https://www.mysql.com/" target="_blank">MySQL</a>
  </span>

- <span style="display: flex; align-items: center;">
  <img src="app/assets/shadcn.png" alt="Shadcn" style="width:16px; height:auto; margin-right:5px;"> 
  <a href="https://ui.shadcn.com/" target="_blank">Shadcn</a>
  </span>

- <span style="display: flex; align-items: center;">
  <img src="app/assets/casbin.png" alt="Casbin(RBAC)" style="width:16px; height:auto; margin-right:5px;"> 
  <a href="https://casbin.org/" target="_blank">Casbin (RBAC)</a>
  </span>

## <img src="app/assets/d11-logo.png" style="width:24px; height:auto; padding-top:8px;" /> Created by Dream Horizon

Dream Horizon is committed to building open-source tools that empower developers and businesses. Learn more about us at our website.

## 🚀 Contribute to Checkmate

Checkmate is an open-source project and welcomes contributions from the community. For details on how to contribute, please see our [guide to contributing](/CONTRIBUTING.md).

## ⚖️ License

This project is published under the [MIT License](/LICENSE).

## ✉️ Contact

If you need feedback or support, reach out via the [Issue Tracker](https://github.com/dream-horizon-org/checkmate/issues) or [Discord](https://discord.gg/wBQXeYAKNc).
