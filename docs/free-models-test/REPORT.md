# Free Faroese TTS/ASR feasibility test (box only)

Test run: 12 Nov 2026, 12:45–12:48 Atlantic/Faeroe (UTC+0).
Hardware: 8 CPU cores, no GPU, 15 GiB RAM (shared box). At TTS start, MemAvailable was 4188.33 MiB.
Software: Python 3.13, torch 2.15.0+cpu, transformers 5.22.2.
No changes were pushed to GitHub or Render.

Source measurements: `/workspace/free-test/tts_metrics.json` and `/workspace/free-test/asr/*.json`.

## 1. Does it work?

Yes, the free models run on CPU and produce audio and transcripts. They are not a drop-in replacement for VoisIT on the live Render app:

- Meta MMS-TTS Faroese synthesised all three Lesson 9 sentences (16 kHz mono, one voice only; VoisIT has four voices).
- The best free Faroese ASR we actually ran, wav2vec2-large-xlsr-53-faroese-100h, was close but not exact on 2 of 3 sentences.
- Official `openai/whisper-base` with `language=fo` accepted the code but produced unusable transcripts.
- These models cannot run on Render’s free 512 MB plan (measured process RAM is already higher than that).
- MMS-TTS is CC-BY-NC 4.0 (non-commercial), which matters because the app is meant for others to use.

Round-trip errors can come from TTS quality, ASR quality, or both. ASR models were trained on real Ravnursson speech, not on MMS-TTS audio. No Faroese speaker rated naturalness, and there was no VoisIT audio to compare.

## 2. TTS: facebook/mms-tts-fao

Model card: https://huggingface.co/facebook/mms-tts-fao
Architecture: VITS, via `transformers.VitsModel`, CPU, `torch.manual_seed(0)`.
Weight file: `model.safetensors` = 145,226,744 bytes (138.50 MiB).
Parameters counted at load: 36,284,400 (138.41 MiB of parameter tensors).
Sampling rate: 16000 Hz.

RAM / time (process RSS via `/proc/self/status` VmRSS):

- After importing torch+transformers: 372.29 MiB
- Load time (includes first Hugging Face download): 6.978 s
- RSS after load: 501.84 MiB (peak during load 508.98 MiB)
- RSS after a warmup pass: 649.68 MiB
- Peak RSS during the three sentences / process max RSS: 679.72 MiB / 679.06 MiB

Per-sentence inference after warmup:

| Sentence | Infer (s) | Audio (s) | RTF | WAV bytes |
|---|---:|---:|---:|---:|
| Hvat er klokkan? | 0.145 | 1.824 | 0.080 | 58,412 |
| Klokkan er átta. | 0.248 | 2.000 | 0.124 | 64,044 |
| Í dag er hósdagur. | 0.271 | 2.448 | 0.111 | 78,380 |

Audio was not silent. Measured peak amplitude 0.70–0.73, RMS 0.069–0.084. Converted to MP3 with ffmpeg libmp3lame `-qscale:a 2`.

Sample files:

- `/workspace/free-test/tts/01-hvat-er-klokkan.wav` (also `.mp3`, 10,988 bytes)
- `/workspace/free-test/tts/02-klokkan-er-atta.wav` (also `.mp3`, 12,068 bytes)
- `/workspace/free-test/tts/03-i-dag-er-hosdagur.wav` (also `.mp3`, 15,200 bytes)

## 3. ASR models found, and round-trip transcripts

Target texts: "Hvat er klokkan?" / "Klokkan er átta." / "Í dag er hósdagur."

### Published Faroese ASR on Hugging Face (not all loaded)

| Model | License (card) | Published Ravnursson Test WER | Weight size | Loaded here? |
|---|---|---:|---|---|
| [carlosdanielhernandezmena/whisper-large-faroese-8k-steps-100h](https://huggingface.co/carlosdanielhernandezmena/whisper-large-faroese-8k-steps-100h) | cc-by-4.0 | 6.889 | repo `usedStorage` 12,347,017,682 bytes | No — too large for this box |
| [carlosdanielhernandezmena/wav2vec2-large-xlsr-53-faroese-100h](https://huggingface.co/carlosdanielhernandezmena/wav2vec2-large-xlsr-53-faroese-100h) | cc-by-4.0 | 7.6 | 1,262,095,537 byte `pytorch_model.bin` | Yes |
| [carlosdanielhernandezmena/whisper-largev2-faroese-8k-steps-100h](https://huggingface.co/carlosdanielhernandezmena/whisper-largev2-faroese-8k-steps-100h) | cc-by-4.0 | 11.944 | `usedStorage` 12,347,017,682 bytes | No |
| [carlosdanielhernandezmena/whisper-small-faroese-5k-steps-100h](https://huggingface.co/carlosdanielhernandezmena/whisper-small-faroese-5k-steps-100h) | cc-by-4.0 | 17.24 | 967,099,139 byte `pytorch_model.bin` | Yes |
| [carlosdanielhernandezmena/whisper-base-faroese-8k-steps-100h](https://huggingface.co/carlosdanielhernandezmena/whisper-base-faroese-8k-steps-100h) | cc-by-4.0 | 22.87 | 290,456,599 byte `pytorch_model.bin` | Yes |
| [carlosdanielhernandezmena/whisper-tiny-faroese-8k-steps-100h](https://huggingface.co/carlosdanielhernandezmena/whisper-tiny-faroese-8k-steps-100h) | cc-by-4.0 | 61.95 | 151,097,331 byte `pytorch_model.bin` | Yes |
| [davidilag/wav2vec2-xls-r-1b-E4-faroese-100h-30-epochs_20250208_v4](https://huggingface.co/davidilag/wav2vec2-xls-r-1b-E4-faroese-100h-30-epochs_20250208_v4) | apache-2.0 | 18.7161 on that card’s own eval set (not the same setup as above) | 962,558,896 F32 params | No |

Best published WER is the Whisper-large Faroese fine-tune (6.889). Best model we could actually load and that also won this 3-sentence round trip is wav2vec2-large-xlsr-53-faroese-100h (published Test WER 7.6).

### openai/whisper and language code `fo`

Yes, official Whisper lists Faroese as `fo` (not `fao`):

- `LANGUAGES` in https://github.com/openai/whisper/blob/main/whisper/tokenizer.py contains `"fo": "faroese"`.
- The [openai/whisper-base](https://huggingface.co/openai/whisper-base) model card language list includes `- fo`, and the Hub tags include `fo`.
- License: `apache-2.0` (YAML on that card).

A 2026 Faroese ASR paper states that Faroese was not included in Whisper’s training data: https://aclanthology.org/2026.speakable-1.17.pdf (p. 2 in the PDF text we retrieved). That is consistent with the unusable `openai/whisper-base` transcripts below. The language *token* exists; a non-fine-tuned Whisper base model did not transcribe these Faroese clips correctly.

Faroese Whisper fine-tunes from Carlos Daniel Hernández Mena (tiny/base/small/large/large-v2, plus a ct2 build) do exist, all `license: cc-by-4.0`.

### Round-trip transcripts (our measurements)

All runs: CPU, one model at a time, warmup on the first WAV, then timed inference. Load seconds include first download.

| Model | Params | Load (s) | Peak RSS (MiB) | "Hvat er klokkan?" | "Klokkan er átta." | "Í dag er hósdagur." | Infer s (1/2/3) |
|---|---:|---:|---:|---|---|---|---|
| wav2vec2-large-xlsr-53-faroese-100h | 315,487,920 | 19.854 | 1732.36 | hvar er klokkan | klokkan er átta | í rað er hósdagur | 0.136 / 0.165 / 0.189 |
| whisper-tiny-faroese-8k-steps-100h | 37,760,640 | 11.490 | 644.24 | hvat er klokkan | tokkan er átti | íra er havsdagur | 0.115 / 0.125 / 0.108 |
| whisper-base-faroese-8k-steps-100h | 72,593,920 | 11.067 | 812.25 | hvar er klokka | tokkan er átti | í ræ er hósdagur | 0.258 / 0.230 / 0.222 |
| whisper-small-faroese-5k-steps-100h | 241,734,912 | 12.823 | 1575.29 | fer er krokkav | klokkan er átti | í rað er hóstaður | 0.693 / 0.616 / 0.655 |
| openai/whisper-base, language=fo | 72,593,920 | 7.291 | 828.40 | Clèl él clèl | Trockan i lot. | Úi da e dao staure. | 0.313 / 0.185 / 0.297 |

wav2vec2 notes: after `from_pretrained`, RSS was only 453.25 MiB (weights appear memory-mapped and not all resident). Peak during load was 1169.79 MiB; peak during inference / max RSS was 1732.36 / 1731.6 MiB. Report 1.73 GiB as the working RAM need, not the post-load figure. wav2vec2 outputs are lowercase and unpunctuated, which is normal for CTC.

On these three clips, wav2vec2 was the closest overall (exact on sentence 2 ignoring case/punctuation; `hvat`→`hvar`; `dag`→`rað`). Whisper-tiny-faroese was exact on sentence 1 but weaker on 2 and 3. Official Whisper base was not usable. These three sentences are not a substitute for the published Ravnursson WER numbers.

## 4. Licenses (exact, from model cards)

- **facebook/mms-tts-fao**: YAML `license: cc-by-nc-4.0`. README section “License” says: “The model is licensed as **CC-BY-NC 4.0**.” Source: https://huggingface.co/facebook/mms-tts-fao and https://huggingface.co/facebook/mms-tts-fao/raw/main/README.md. Official name: Creative Commons Attribution-NonCommercial 4.0 International (https://creativecommons.org/licenses/by-nc/4.0/). This is a non-commercial licence. It is not legal advice, but it is a real constraint if the app is public for other people to use.

- **carlosdanielhernandezmena/wav2vec2-large-xlsr-53-faroese-100h** and the same author’s Whisper Faroese fine-tunes (tiny, base, small, large, large-v2): YAML `license: cc-by-4.0`. Sources: each model’s README, e.g. https://huggingface.co/carlosdanielhernandezmena/wav2vec2-large-xlsr-53-faroese-100h/raw/main/README.md. Official name: Creative Commons Attribution 4.0 International (https://creativecommons.org/licenses/by/4.0/). Allows commercial use with attribution (still not legal advice).

- **openai/whisper-base** (and other official Whisper sizes): YAML `license: apache-2.0`. Source: https://huggingface.co/openai/whisper-base.

- Browser ONNX copies (not run in this test):
  - [iii-bs/wav2vec2-faroese-onnx](https://huggingface.co/iii-bs/wav2vec2-faroese-onnx): YAML `license: cc-by-sa-4.0`, `library_name: transformers.js`, described as an ONNX export of the wav2vec2 Faroese model for in-browser use. ShareAlike is stricter than the base CC-BY-4.0.
  - [OpenVoiceOS/wav2vec2-xlsr-53-faroese-onnx](https://huggingface.co/OpenVoiceOS/wav2vec2-xlsr-53-faroese-onnx): YAML `license: cc-by-4.0`; README says “CC BY 4.0, inherited from the base model.” Aimed at the `onnx-asr` runtime, not transformers.js.
  - [PierreMesure/whisper-*-faroese-*-ONNX](https://huggingface.co/PierreMesure/whisper-tiny-faroese-8k-steps-100h-ONNX): `library_name: transformers.js`; the tiny README has no `license:` field in the YAML we fetched. The base model is CC-BY-4.0.

## 5. Hosting

### Render free (current live host)

Cannot host these PyTorch models. Render’s own docs list the free web-service compute plan as **0.1 CPU / 512 MB RAM**, and it spins down after 15 minutes idle: https://render.com/docs/free (glossary: “compute plan”).

Measured process RSS:

- Python + torch + transformers, no speech model yet: 372.29 MiB
- MMS-TTS peak: 679.72 MiB
- wav2vec2-large peak: 1732.36 MiB
- Whisper-small-faroese peak: 1575.29 MiB
- Whisper-tiny-faroese peak: 644.24 MiB (still over 512 MiB)

A paid Render plan with 2 GB RAM (`1c-2g` in the same glossary) could likely run MMS-TTS plus the existing Node server, loading one model at a time. wav2vec2 at 1.73 GiB peak leaves little headroom next to Node and the OS; **4 GB is the realistic minimum** if ASR stays on the server. Not measured on Render itself.

### Hugging Face Spaces

[Spaces Overview](https://huggingface.co/docs/hub/en/spaces-overview) and [pricing](https://huggingface.co/pricing) list **CPU Basic as 2 vCPU / 16 GB RAM / 50 GB disk, hourly price Free**. 16 GB would be enough for MMS-TTS and wav2vec2-large, and probably for Whisper-large if wanted.

Caveat from the same Spaces Overview page (current wording): “Static Spaces are free for everyone. Gradio and Docker Spaces run on compute and require a paid plan to create: PRO for personal accounts, Team or Enterprise for organizations. Free personal accounts in good standing can still host up to 2 Gradio Spaces running on ZeroGPU.” So “free CPU 16 GB” is not automatically available to a free HF account for a Gradio/Docker model server. Free hardware also sleeps after idle. ZeroGPU is Gradio-only and uses visitor GPU quota.

A **Static Space** (or Render static site) plus in-browser inference would be free to host, if models are converted to ONNX.

### User’s own PC

This test already ran on CPU with ~4 GiB available. A laptop/desktop with 4+ GiB free RAM can run TTS and wav2vec2. Pros: no hosting RAM cap, private mic audio can stay local. Cons: every user needs to run a local server, or only the owner can host; not “open the website and use it.”

### Browser: transformers.js / ONNX

transformers.js **does** support this path in general:

- VITS / MMS-TTS: `VitsModel` and the `text-to-speech` pipeline, documented for e.g. `Xenova/mms-tts-eng` (https://huggingface.co/Xenova/mms-tts-eng) and in `@huggingface/transformers` typings for `VitsModel`. Support was added in https://github.com/xenova/transformers.js/pull/466.
- wav2vec2 ASR: supported since https://github.com/huggingface/transformers.js/pull/220.

What exists today for Faroese, from Hub API searches on 12 Nov 2026:

- No public `Xenova/mms-tts-fao` or `onnx-community/mms-tts-fao` (API returned HTTP 401; search for `mms-tts-fao` only returned `facebook/mms-tts-fao`). A Faroese MMS-TTS browser build would need an ONNX export (the Xenova English repo describes this pattern). The CC-BY-NC 4.0 licence still applies to those weights.
- A ready transformers.js wav2vec2 Faroese model **does** exist: `iii-bs/wav2vec2-faroese-onnx` (fp32 ONNX, ~1.26 GB `usedStorage` 1,262,353,008 bytes). That is large for phones. There are also PierreMesure transformers.js ONNX builds of the smaller Faroese Whisper fine-tunes, which would download less but, in our PyTorch test, were less accurate than wav2vec2 on these clips.

Pros of browser-side: hosting can be a free static site; the 512 MB Render cap no longer matters; mic audio need not go to a server (GDPR is simpler than VoisIT, which keeps ASR recordings). Cons: first-load download is large (tens to hundreds of MB, or ~1.26 GB for fp32 wav2vec2); mobile CPUs may be slow; MMS-TTS ONNX for Faroese still has to be built; NC licence still blocks commercial use of MMS-TTS; we did not measure in-browser speed or quality.

## 6. Recommendation

Do not switch the live Render app from VoisIT to these models as a free drop-in.

- **Quality:** free TTS/ASR works, but the 3-sentence round trip was imperfect, there is only one MMS voice, and unofficial Whisper-without-fine-tune is not usable for Faroese. VoisIT was not compared because no API key was used in this test.
- **Licence:** MMS-TTS is non-commercial (CC-BY-NC 4.0). The wav2vec2 / Faroese Whisper fine-tunes are CC-BY-4.0 (attribution). That alone may rule out MMS-TTS for a public app “for others to use,” depending on how the project is classified. Get a licence read before shipping.
- **Hosting:** Render free (512 MB) cannot run them. Options that can: a paid Render instance with about 4 GB RAM; a Hugging Face Gradio/Docker Space (16 GB CPU Basic is enough, but creating it currently needs a paid HF plan, with a narrow free ZeroGPU exception); the owner’s PC; or a static site plus transformers.js after ONNX export (ASR already has a Faroese transformers.js model; TTS does not, yet).

A realistic “free as in no VoisIT bill” path, if the licences are acceptable: pre-generate lesson audio (or convert MMS-TTS to ONNX and run it in the browser) and run ASR in the browser with `iii-bs/wav2vec2-faroese-onnx` or a smaller Faroese Whisper ONNX, keeping the current Node app as a static/lesson frontend. If pronunciation quality and four voices matter more than cost, keep VoisIT for speech.

Whisper-large-faroese (best published WER, 6.889) was not loaded here; it would need several GB of RAM and was out of scope for this box.
