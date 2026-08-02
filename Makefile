.PHONY: setup lint test build up down clean demo

setup:
	npm run setup

lint:
	npm run format:check
	npm run lint
	npm run typecheck

test:
	npm run test:coverage

build:
	npm run build

up:
	docker compose up --build -d

down:
	docker compose down --remove-orphans

clean:
	docker compose down --volumes --remove-orphans
	rm -rf coverage dist frontend/dist reports

demo:
	bash scripts/demo.sh
