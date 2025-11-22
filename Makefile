.PHONY: quality style test

quality:
	black --check --line-length 119 --target-version py310 --exclude .venv .
	isort --check-only --skip .venv .
	flake8 --max-line-length 119 --exclude .venv

style:
	black --line-length 119 --target-version py310 --exclude .venv .
	isort --skip .venv .

test:
	pytest -sv ./src/

pip:
	rm -rf build/
	rm -rf dist/
	make style && make quality
	python -m build
	twine upload dist/* --verbose --repository aiaio

docker-build:
	docker build -t aiaio .

docker-run:
	docker run --network=host -it --rm aiaio