# Newflare — Design Notes (Dark Premium)

Objectiu: disseny visual premium, majoritàriament fosc, minimalista, amb tocs de color vius per destacar reactivitat musical.

Principis
- Paleta base: Very dark gray (#0B0B0E), off-black accents, subtle gradients.
- Acent colors: neon teal (#00FFD5), magenta (#FF3BAC), gold (#FFC857) — aplicar com a highlights i per paletes dinàmiques.
- Tipografia: Inter / Space Grotesk per UI, Variable font amb pesos regular/semibold/medium.
- UI chrome: suau (blur + translucent panels), radiuses 8px, spacing amplificat per aspecte premium.
- Motion: transicions suaus 160–240ms, easing cubic-bezier(0.22, 1, 0.36, 1) per elements interactius.

Canvas / Render
- Fons: gradient radial o subtle noise texture per evitar negre pla.
- UI overlay: panels semitransparents amb `backdrop-filter: blur(6px)` (si el navegador ho suporta).
- Controls: botons minimal amb icones lineals (feather or heroicons style), sliders amb pista luminosa quan estan actius.

Paletes Procedurals
- Implementar cosinus palette function per presets:
  color(t) = a + b * cos(2 * PI * (c * t + d))
- Ofereix presets de paleta (Warm, Neon, Ocean, Electro) i slider per phase offset.

Recording UI
- Botó prominent `REC` vermell when idle, `STOP` gris quan gravant.
- Indicador d'estat (resolució, bitrate, frame-rate actual) en petit label.

Accessibility
- Contrastes alts en labels; opcional mode de text brillant.
- Tecles d'accés: p (play/pause), r (record), s (screenshot), f (fullscreen).

Responsive
- Desktop primari (4K), però adaptar a resolucions menors amb escalat dinàmic (preserve pixel ratio lowered at >2x DPR)

Assets i icones
- SVG icons, compact sprites per guanyar rendiment.

UI Layout (superposición)
- Top-left: logo + preset selector
- Top-right: media source selector + upload
- Right side (collapsible): `lil-gui`-like panel amb controls
- Bottom-center: transport + record + download

Notes tècniques
- Usar CSS variables per theming i permetre quick theme toggles (clear for light).
- Guardar presets JSON que incloguin palette params, shader params i particle params.
