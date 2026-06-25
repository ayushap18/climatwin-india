# ClimaTwin India — task runner.  Uses the project venv if present.
PY ?= $(shell [ -x .venv/bin/python ] && echo .venv/bin/python || echo python3)

.PHONY: help venv install data data-imd data-lst insat train downscale validate serve test bundle clean

help:
	@echo "make install   - create .venv (py3.13) and install requirements"
	@echo "make data      - build twin_cube.nc (offline synthetic fallback)"
	@echo "make data-imd  - build twin_cube.nc from real IMD data via imdlib"
	@echo "make data-lst  - build real IMD cube WITH INSAT LST fusion (--with-lst)"
	@echo "make insat     - build the INSAT LST layer only -> data/insat_lst.nc"
	@echo "make train     - train the ConvLSTM forecaster -> checkpoints/convlstm.pt"
	@echo "make downscale - train the SR-CNN downscaler -> checkpoints/downscale.pt"
	@echo "make validate  - validation metrics (baselines + ConvLSTM) -> validation_metrics.json"
	@echo "make serve     - run FastAPI backend on :8000"
	@echo "make test      - end-to-end smoke test of the slice"
	@echo "make bundle    - zip the repo for Google Colab upload (climatwin_bundle.zip)"

venv:
	python3.13 -m venv .venv

install: venv
	.venv/bin/python -m pip install --upgrade pip
	.venv/bin/python -m pip install -r requirements.txt

data:
	$(PY) -m data.build_cube --source auto

data-imd:
	$(PY) -m data.build_cube --source imd

data-lst:
	$(PY) -m data.build_cube --source imd --with-lst

insat:
	$(PY) -m data.ingest_insat

train:
	$(PY) -m models.train

downscale:
	$(PY) -m models.downscale --var rainfall

validate:
	$(PY) -m models.validate

serve:
	$(PY) -m uvicorn backend.app:app --reload --port 8000

test:
	$(PY) -m backend.smoke_test

bundle:
	bash scripts/make_colab_bundle.sh

clean:
	rm -f data/twin_cube.nc data/norm_stats.json data/insat_lst.nc models/validation_metrics.json
	rm -rf data/raw
