<template>
  <main class="app-shell" data-testid="app-shell">
    <header class="app-header">
      <span class="app-mark" aria-hidden="true">&#9632;</span>
      <strong>Sandkasten</strong>
      <span class="app-status">Ready</span>
    </header>
    <section class="app-placeholder" aria-labelledby="app-title">
      <h1 id="app-title">Code runner</h1>
      <p>Choose a runtime and run source code.</p>
    </section>
  </main>
</template>

<style>
:root {
  color: #211d1e;
  background: #f7f6f3;
  font-family: Inter, system-ui, sans-serif;
}

* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; }
.app-shell { min-height: 100vh; }
.app-header { display: flex; align-items: center; gap: 0.6rem; min-height: 52px; padding: 0 1rem; border-bottom: 1px solid #d9d3d4; background: #fff; }
.app-mark { color: #d95f8d; font-size: 0.8rem; }
.app-status { margin-left: auto; color: #746b6d; font-size: 0.8rem; }
.app-placeholder { max-width: 960px; margin: 0 auto; padding: 3rem 1rem; }
.app-placeholder h1 { margin: 0 0 0.5rem; font-size: 1.5rem; }
.app-placeholder p { margin: 0; color: #746b6d; }
</style>
