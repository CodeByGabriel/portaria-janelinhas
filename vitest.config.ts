import { defineConfig } from 'vitest/config'
import { cloudflareTest } from '@cloudflare/vitest-plugin'

/*
  Dois runners, de proposito.

  `node --test` cobre os modulos puros (estados, livro, busca, importar,
  semente, espera) — 113 testes, zero dependencia, arranque instantaneo. Eles
  nao precisam de runtime de Worker e nao devem pagar por um.

  Este aqui cobre o que Node NAO consegue instanciar: o Durable Object precisa
  de WebSocketPair e DurableObjectState, que so existem no workerd. Ate agora
  `portaria.ts` e `index.ts` nao tinham um unico teste de unidade — toda a
  camada de rede vivia so sob o fim-a-fim, que exige servidor de pe.

  Convencao de nome que separa os dois:
    src/*.test.ts  -> node --test   (puro)
    src/*.spec.ts  -> vitest        (workerd)
*/
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
    }),
  ],
  test: {
    include: ['src/**/*.spec.ts'],
    // Cada teste de persistencia abre WebSockets, evicta o objeto e reconecta.
    // 5s (o padrao) e apertado para isso e produz falha falsa.
    testTimeout: 20000,
  },
})
