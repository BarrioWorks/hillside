# Selected asset provenance

## Runtime integration

The pipeline now produces five normalized, self-contained GLBs. All five pass `npm run assets:validate`. [runtime-asset-report.md](runtime-asset-report.md) records exact output bounds, materials, modifications, and the 63 removed degenerate triangles. Runtime hashes and embedded provenance are in `web/public/models/manifest.json`.

The game loads `building-a.glb` as a community landmark. The placeable Tienda and Taller also reuse the imported awning and overhang through `ModelLibrary.loadDetails`. Browser inspection confirmed both catalog details and the landmark reached their ready states. The contact sheet renders all eleven catalog objects at 128px and 512px under the same lighting.

The original-file inspection below remains the record of acquisition. Its original dimensions and triangle counts differ deliberately from the normalized outputs.

## Original acquisition

Retrieved on 2026-10-20. Original files are in `asset-sources/kenney-city-kit-commercial/`. No pack archive is in the public directory.

The publisher is Kenney. The pack is [City Kit Commercial 2.1](https://kenney.nl/assets/city-kit-commercial). The original archive is [kenney_city-kit-commercial_2.1.zip](https://kenney.nl/media/pages/assets/city-kit-commercial/a742d900eb-1753115042/kenney_city-kit-commercial_2.1.zip). Its SHA-256 is `f8b09b081c2bb88bcc126e2dec1cb40fd0dad7e7e591b6c26aaefe96fb35276b`.

The original packaged `License.txt` declares Creative Commons Zero and permits personal, educational, and commercial use. Its creation date is 21 July 2025. Keep this file with the originals. `provenance.json` records each original archive member, byte length, and SHA-256. These are extracted originals without geometry or material changes.

| Original file | Bytes | Vertices | Triangles | Bounds size X, Y, Z | Intended adaptation |
| --- | ---: | ---: | ---: | --- | --- |
| `building-a.glb` | 108936 | 2074 | 1252 | 0.883588, 1.293, 0.94 | Compact multi-storey building shell |
| `building-e.glb` | 128208 | 2443 | 1509 | 1.64, 0.893, 1.007892 | Wide storefront or workshop shell |
| `building-i.glb` | 209728 | 4012 | 2544 | 1.24, 1.68, 1.302 | Larger apartment shell |
| `detail-awning.glb` | 5528 | 76 | 40 | 0.4, 0.4, 0.147891 | Storefront shade |
| `detail-overhang.glb` | 6704 | 100 | 64 | 0.5, 0.4, 0.2 | Concrete canopy |
| `Textures/colormap.png` | 11002 | n/a | n/a | n/a | Required shared palette texture |

All five GLBs have one mesh, one material, and identity node transforms. They use Y up. Building bases are at Y=0. Details extend toward positive Z and need deliberate facade placement. Bounds come from decoded float positions, rather than accessor metadata alone. These numbers describe originals, not optimized output.

The GLBs contain their binary vertex buffers but reference `Textures/colormap.png` externally. Preserve the exact relative path or embed the texture during conversion. Loading a GLB alone will cause a texture request failure. The source palette is cool gray urban architecture. Recoloring, parapets, balconies, tanks, and planted terraces are adaptations needed for the game's brief. The pack does not establish Colombian architectural authenticity.

The frontend owner is responsible for producing normalized runtime GLBs, output hashes, six distinct catalogue adaptations, runtime loading, and the gameplay-scale contact sheet. This manifest does not claim those tasks are complete. The final pipeline should retain Kenney provenance in GLB asset extras or output metadata. Scale X and Z within each Rust footprint, put the base at zero, and leave room for facade additions. Avoid scaling canopies with the whole building when a fixed-size detail is intended.

Run `python3 tools/research/inspect-assets.py` to verify original hashes, GLB chunks, local texture existence, finite positions, and triangle counts. It writes `tools/research/asset-inspection.json`. This check does not validate the final converted models, texture decoding, GPU rendering, or contact-sheet appearance. Run `python3 tools/research/acquire-assets.py` to download the pinned archive and extract only the selected files and packaged license.

## Other requested publishers

| Source inspected | Publisher evidence | Selection decision |
| --- | --- | --- |
| [Kenney Modular Buildings](https://kenney.nl/assets/modular-buildings) | CC0, 100 files, version 2.1 complete remake | Viable modular alternative. Not imported because the selected commercial files already supply usable GLB shells and facade details. |
| [Quaternius Ultimate Textured Buildings](https://quaternius.com/packs/ultimatetexturedbuildings.html) | Page says Ultimate Buildings Pack, 76 models, FBX, OBJ, Blend, CC0, December 2019 | Not imported. Requires conversion and uses a Google Drive folder download. No pack contents or packaged license were inspected. |
| [Kenney Building Kit](https://kenney-assets.itch.io/building-kit) | CC0 1.0, over 80 wall, floor, door, and window models, OBJ, FBX, glTF | Viable structural alternative. Not imported. Building composition would add pipeline work before the first playable render. |

Source page snapshots are under `tools/research/sources/`. Publisher pages were inspected for all four sources. Only the selected commercial archive was downloaded. No claim is made about uninspected pack internals.

## Reference photographs

The three `*-reference.jpg` files in `tools/research/sources/` are research references from the municipal government and Metro operator. They are not CC0 game assets. They must not enter runtime output. Their source links and observations are in `docs/open-source-research.md`.
