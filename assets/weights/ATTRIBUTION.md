# OIDN denoiser weights

Three trained Open Image Denoise models (`.tza`, custom binary format) loaded by `oidn-webgpu` when the path-traced viewport denoises a finished frame. `rt_hdr_alb_nrm.tza` / `rt_hdr_alb_nrm_small.tza` are the guided (albedo + normal) models for the `base` / `small` choices; `rt_hdr.tza` is the color model used alongside either.

Based on **Open Image Denoise** weights published by Intel at https://github.com/RenderKit/oidn-weights (master), licensed [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
Fetched from `https://media.githubusercontent.com/media/RenderKit/oidn-weights/master/<file>`; sizes: 1830792 / 1841160 / 641480 bytes.

No modifications: the files are used as published.
