# ClearDraft Local

A private academic and clinical writing assistant that runs a free local AI model in your browser. No paid API, account, or server-side processing is required.

## Features

- Side-by-side original and revised drafts
- Light, moderate, and strong rewriting controls
- Academic and clinical modes
- Protected terms plus automatic protection for citations, quotations, URLs, numbers, doses, and common clinical terminology
- Change highlighting, copy, download, clear, and restart controls
- On-device inference with WebLLM and Qwen 2.5 1.5B Instruct

## Browser requirements

Use a current desktop version of Chrome or Edge with WebGPU enabled. The first revision downloads about 1 GB of model files and stores them in the browser cache. Later sessions reuse the cached model.

## Run locally

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Privacy and academic integrity

Drafts are processed in the browser and are not sent to a paid rewriting API. AI output can still contain mistakes, so compare every revision with the original. This tool improves clarity; it does not promise any AI-detector result.

## Deployment

Pushes to `main` are built and deployed automatically with GitHub Pages. The workflow is in `.github/workflows/deploy-pages.yml`.
