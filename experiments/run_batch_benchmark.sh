#!/bin/bash
# Batch OCR benchmark runner for BP monitor images
# Run this on the machine with Ollama (PC03)

set -e

MODELS=("$@")
if [ ${#MODELS[@]} -eq 0 ]; then
    echo "Usage: ./run_batch_benchmark.sh <model1> [model2] [model3] ..."
    echo ""
    echo "Examples:"
    echo "  ./run_batch_benchmark.sh qwen3:0.6b qwen3:1.7b"
    echo "  ./run_batch_benchmark.sh qwen3.5-4b-instruct:latest medgemma:latest"
    exit 1
fi

for MODEL in "${MODELS[@]}"; do
    echo ""
    echo "============================================================"
    echo "Testing: $MODEL"
    echo "============================================================"
    
    # Check if model exists locally
    if ! ollama list | grep -q "$MODEL"; then
        echo "Model $MODEL not found. Pulling..."
        ollama pull "$MODEL"
    fi
    
    OUTPUT="${MODEL//:/_}_results.json"
    
    python3 test_ollama_vision.py \
        --model "$MODEL" \
        --all-samples \
        --output "$OUTPUT"
    
    echo "Results saved to: $OUTPUT"
done

echo ""
echo "============================================================"
echo "All benchmarks complete!"
echo "============================================================"

# Print summary
for MODEL in "${MODELS[@]}"; do
    OUTPUT="${MODEL//:/_}_results.json"
    if [ -f "$OUTPUT" ]; then
        python3 -c "
import json
with open('$OUTPUT') as f:
    d = json.load(f)
print(f\"{d['model']:30} | FULL_MATCH: {d.get('full_matches',0)}/{d.get('total_runs',0)}\")
"
    fi
done
