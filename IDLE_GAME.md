# Jogo idle (fork do tsps)

Este fork transforma o tsps num jogo idle de OSRS, mantendo o mundo 3D e as contas online.
Tudo é um plugin, o **IdleMode**, que liga um "modo idle" por conta, do mesmo jeito que o
Ironman. A documentação técnica completa (em inglês, como o resto do projeto) está em
[`docs/idle-mode.md`](docs/idle-mode.md).

## Como rodar

```bash
npm run setup
```

```bash
yarn start
```

Abra http://localhost:3000. O cache do jogo é baixado de `archive.openrs2.org` na primeira vez.

## Mundo idle (todas as contas novas já começam idle)

Crie `server/data/definitions/world.local.json` (ele não entra no git) com:

```json
{
  "pluginConfig": { "IdleMode:newAccounts": true }
}
```

Sem isso, cada jogador liga o modo com `::idle on`.

## Comandos no jogo

| Comando | O que faz |
| --- | --- |
| `::idle` | Abre a tela do modo idle: status, pontos, melhorias e botões |
| `::idle status` | Diz no chat se o modo idle está ligado |
| `::idle on` / `::idle off` | Liga ou desliga o modo idle da conta |
| `::idle auto` | Mostra o que o personagem vai retomar sozinho |
| `::idle auto on` / `::idle auto off` | Liga ou desliga a retomada automática |
| `::idle travel` | Abre a tela de viagem: escolha uma atividade e o personagem vai até lá |
| `::idle go <local>` | Viaja direto pra um local (ex.: `draynor-willows`, `lumbridge-cows`) |
| `::idle sites` | Lista os locais disponíveis |
| `::idle points` | Mostra seus pontos idle |
| `::idle shop` | Lista as melhorias, níveis e preços |
| `::idle buy <melhoria>` | Compra o próximo nível (`quick-hands`, `long-dreams`, `bountiful-harvest`) |

![A tela do modo idle](docs/images/idle-screen.png)

## O que o modo idle faz

1. **Coleta infinita** (Woodcutting, Mining, Fishing): tudo vai direto pro banco, árvores e
   pedras não se esgotam, os pontos de pesca não mudam de lugar, não há random events e o pop-up
   de level-up não interrompe.
2. **Progresso offline**: ao sair no meio de uma atividade, o servidor guarda a taxa real que você
   tinha (itens e XP por hora). Ao voltar, paga o tempo fora (até 12h, mais com melhorias) e mostra
   o resumo "While you were away...".
3. **Retomada automática**: o último recurso em que você trabalhou vira o alvo. Quando a coleta
   para, o personagem anda até o mais próximo do mesmo tipo e recomeça.
4. **Pontos e melhorias**: 1 ponto a cada 250 XP idle. As melhorias são Quick Hands
   (ações mais rápidas), Long Dreams (mais horas offline) e Bountiful Harvest (recursos extras).
5. **Combate idle**: ataque e mate um monstro, e o personagem continua atacando os do mesmo tipo
   por perto. Ele come quando a vida fica abaixo de 50%, revida quando é atacado e manda os drops
   pro banco. Também conta para o progresso offline.
6. **Viagem até a atividade**: na tela `::idle travel` (ou no botão Travel da tela idle), escolha
   entre 21 locais (árvores, minas, pesca e monstros, de Lumbridge a Karamja). O personagem
   teleporta e já começa a trabalhar sozinho. Locais de coleta pedem o nível da skill.

![A tela de viagem](docs/images/idle-travel.png)

Todos os números (velocidades, limites, preços) ficam em
`server/plugins/modes/data/idle-mode.json`.

## Testes

```bash
cd server && node --test tests/idle-mode.test.cjs
```

O teste dos locais de viagem usa o cache do jogo (baixado no primeiro `yarn start`):

```bash
cd server && node --test tests/idle-travel-sites.test.cjs
```

## Atualizar com o projeto original

```bash
git fetch upstream && git merge upstream/main
```

O código idle fica em arquivos próprios (`server/plugins/modes/idle/`). Do projeto original, só
três pontos foram mexidos, todos pequenos: `Fishing.plugin.js` ganhou um evento
(`fishing:spot-stays`), `SkillLevelUp.plugin.js` passou a ler um atributo do jogador
(`level-up:keep-actions`) e `docs/world-configuration.md` ganhou uma seção. Assim os merges com o
upstream ficam simples.
