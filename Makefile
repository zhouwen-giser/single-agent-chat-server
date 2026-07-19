.PHONY: install verify build image compose-up compose-down sbom

install:
	pnpm install --frozen-lockfile

verify:
	pnpm verify:phase10

build:
	pnpm build

image:
	docker build --target runtime -t single-agent-chat-server:0.1.0 .

compose-up:
	docker compose up -d --build

compose-down:
	docker compose down --volumes

sbom:
	pnpm generate:sbom
