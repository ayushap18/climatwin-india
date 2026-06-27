# Local LLM models for ClimaTwin (brain + guide)

ClimaTwin's two AI layers are **offline-first** — they work with no LLM at all (deterministic
planning + grounding). A local model only makes the *prose* friendlier. Both layers verify
every number against the twin, so a small model can rephrase but **never fabricate**.

| Layer | What it does | Env var | Endpoint |
|---|---|---|---|
| **Brain** | *operates* the twin: plan → call tools → critique → cited answer | `OLLAMA_MODEL` | `/brain` |
| **Guide** | *explains* the current screen simply for non-experts | `OLLAMA_GUIDE_MODEL` (falls back to `OLLAMA_MODEL`) | `/guide` |

## 1. Quick start (use a stock model)

```bash
brew install ollama && ollama serve &      # one-time
ollama pull qwen2.5:3b-instruct            # ~2 GB, runs on a MacBook Air
export OLLAMA_MODEL=qwen2.5:3b-instruct
make serve                                 # brain + guide now use it; restart to apply
```

Leave the vars unset and everything still works — the deterministic grounded answers are used.

## 2. Customise the voice (no training — just a system prompt)

The two `*.Modelfile`s here bake in the right persona:

```bash
ollama create climatwin-brain  -f ollama/climatwin-brain.Modelfile
ollama create climatwin-guide  -f ollama/climatwin-guide.Modelfile
export OLLAMA_MODEL=climatwin-brain
export OLLAMA_GUIDE_MODEL=climatwin-guide
```

## 3. Fine-tune your own model (custom, on the twin's own data)

1. **Export grounded training data from your twin** (server must be running):
   ```bash
   make serve &
   python scripts/export_finetune_data.py     # → data/finetune_brain.jsonl + finetune_guide.jsonl
   ```
   This produces OpenAI-style chat JSONL grounded in *your* twin. Expand it (more dates,
   more phrasings) to a few hundred diverse pairs before training.

2. **Fine-tune** a small base (LoRA is plenty) with any stack that reads chat JSONL —
   e.g. **MLX-LM** (Apple Silicon), **Unsloth**/**Axolotl** (Colab/GPU), or **llama-factory**:
   ```bash
   # MLX-LM example (Apple Silicon, LoRA):
   pip install mlx-lm
   mlx_lm.lora --model Qwen/Qwen2.5-3B-Instruct --train \
     --data data/finetune_brain.jsonl --iters 400 --adapter-path adapters/brain
   mlx_lm.fuse  --model Qwen/Qwen2.5-3B-Instruct --adapter-path adapters/brain \
     --save-path models/climatwin-brain-ft
   ```

3. **Serve it via Ollama** — point a Modelfile's `FROM` at your fused GGUF (convert with
   `llama.cpp`'s `convert_hf_to_gguf.py` if needed), then `ollama create` and set the env var.
   The grounding guard keeps it honest no matter how it was trained.

> Honesty note: fine-tuning changes the *wording*, not the *numbers*. The twin's deterministic
> tools + grounding guard remain the source of truth — that's what keeps ClimaTwin defensible.
