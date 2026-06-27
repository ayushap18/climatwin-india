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

## 3. Fine-tune your OWN model on Colab (recommended path)

**Best base model: `Qwen2.5-3B-Instruct`** — best instruction-following + structured/tool
reasoning at a size that QLoRA-fine-tunes on a free Colab T4 and runs fast on a MacBook Air.
Train ONE model on BOTH personas (the system prompts separate them) → serve it as both layers.

| Model | Size | Note |
|---|---|---|
| **Qwen2.5-3B-Instruct** ⭐ | 3B | recommended for both brain + guide |
| Llama-3.2-3B-Instruct | 3B | strong alternative |
| Phi-3.5-mini | 3.8B | great reasoning, a touch bigger |
| Qwen2.5-1.5B-Instruct | 1.5B | ultra-light, guide-only |

### Step 0 — make the data locally (server running)
```bash
make serve &
python scripts/export_finetune_data.py         # → data/finetune_{brain,guide,all}.jsonl (~200+ pairs)
```
Train on **`data/finetune_all.jsonl`**. For a stronger model, run it a few times or add more
dates/phrasings in the script — more diverse pairs = better generalisation.

### Step 1 — Colab (Unsloth, free T4)
New notebook → **Runtime ▸ T4 GPU**, then:
```python
!pip install -q "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git" trl peft accelerate bitsandbytes
```
```python
from unsloth import FastLanguageModel
model, tok = FastLanguageModel.from_pretrained("unsloth/Qwen2.5-3B-Instruct",
    max_seq_length=2048, load_in_4bit=True)
model = FastLanguageModel.get_peft_model(model, r=16, lora_alpha=16,
    target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"])
```
```python
# upload data/finetune_all.jsonl via the Files panel, then:
from datasets import load_dataset
ds = load_dataset("json", data_files="finetune_all.jsonl", split="train")
ds = ds.map(lambda x: {"text": tok.apply_chat_template(x["messages"], tokenize=False)})
```
```python
from trl import SFTTrainer
from transformers import TrainingArguments
SFTTrainer(model=model, tokenizer=tok, train_dataset=ds, dataset_text_field="text",
    max_seq_length=2048, args=TrainingArguments(per_device_train_batch_size=2,
        gradient_accumulation_steps=4, warmup_steps=5, max_steps=300, learning_rate=2e-4,
        fp16=True, logging_steps=10, optim="adamw_8bit", output_dir="out")).train()
```
```python
# export a GGUF Ollama can serve, then download it
model.save_pretrained_gguf("climatwin-ft", tok, quantization_method="q4_k_m")
from google.colab import files; files.download("climatwin-ft/unsloth.Q4_K_M.gguf")
```

### Step 2 — serve YOUR model on the Mac
```bash
mkdir -p ~/climatwin-ft && mv ~/Downloads/unsloth.Q4_K_M.gguf ~/climatwin-ft/
printf 'FROM %s/climatwin-ft/unsloth.Q4_K_M.gguf\nPARAMETER temperature 0.3\n' "$HOME" > ~/climatwin-ft/Modelfile
ollama create climatwin-ft -f ~/climatwin-ft/Modelfile
export OLLAMA_MODEL=climatwin-ft OLLAMA_GUIDE_MODEL=climatwin-ft
make serve                                     # both AI layers now use YOUR fine-tuned model
```

**No-Colab alternative (Apple Silicon):** `mlx_lm.lora --model Qwen/Qwen2.5-3B-Instruct --train
--data data/finetune_all.jsonl --iters 400 …` then `mlx_lm.fuse` → GGUF → `ollama create`.

> Honesty note: fine-tuning changes the *wording*, not the *numbers*. The twin's deterministic
> tools + grounding guard remain the source of truth — that's what keeps ClimaTwin defensible.
