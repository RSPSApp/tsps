# Roadmap do jogo idle

O que já está pronto e o que falta para o jogo idle estar jogável por qualquer pessoa. Os detalhes
técnicos do que já existe estão em [`docs/idle-mode.md`](docs/idle-mode.md); o guia rápido, em
[`IDLE_GAME.md`](IDLE_GAME.md).

Prioridades: **P0** = sem isso ninguém de fora consegue jogar; **P1** = deixa o jogo bom de jogar;
**P2** = depois.

## Já pronto

- [x] Modo idle por conta (`::idle on`) e mundo idle para contas novas (`IdleMode:newAccounts`)
- [x] Coleta infinita: Woodcutting, Mining e Fishing vão direto pro banco, sem esgotar recursos
- [x] Progresso offline medido pela taxa real (até 12h, mais com melhoria)
- [x] Retomada automática, com pausa ao fazer outra coisa e troca de alvo quando um não dá certo
- [x] Combate idle: ataca o mesmo tipo de monstro, come, revida e manda o loot pro banco
- [x] Pontos idle e 3 melhorias (Quick Hands, Long Dreams, Bountiful Harvest)
- [x] Tela do modo idle (`::idle`) com status, pontos, melhorias e botões
- [x] Viagem até 21 atividades (`::idle travel`), com locais conferidos no mapa real
- [x] Kit inicial, primeiro login guiado e botão Idle fixo na aba do diário

## P0 - Para alguém de fora conseguir jogar

- [ ] **Hospedar o servidor**: uma máquina ligada 24h, domínio, HTTPS/WSS, e o cliente publicado
      (`yarn start:prod`, ou listar o mundo pelo rsps.app com um token no `.env`)
- [ ] **Backup dos saves**: cópia automática do `server/data/saves/players.sqlite`
- [ ] **Mundo idle ligado por padrão** no servidor publicado (`world.local.json` com
      `IdleMode:newAccounts`)
- [x] **Kit inicial**: na primeira vez que a conta fica idle, recebe machado, picareta, rede,
      espada e 10 camarões (no banco, se o inventário estiver cheio)
- [x] **Primeiro login guiado**: o Tutorial Island já vem desligado; conta nova num mundo idle
      começa em Lumbridge, recebe 3 linhas de boas-vindas e a tela idle abre sozinha
- [x] **Abrir a tela idle sem comando**: botão **Idle** na aba do diário (Character Summary)
- [x] **Reinício e crash do servidor**: quem estava jogando recebe o progresso offline ao voltar
      (testado no jogo com SIGTERM e com `kill -9`; num crash, a partir do último salvamento
      automático, de 5 a 10 minutos)
- [ ] **Decisão jurídica**: o jogo usa o cache e o conteúdo do OSRS (Jagex). Antes de abrir ao
      público, e principalmente antes de cobrar qualquer coisa, decidir o risco (ver "Loja de
      Idle Coins")

## P1 - Interface do sistema idle

Uma interface própria e sempre à mão, para o jogador nunca precisar digitar comandos.

- [x] **Botão fixo do idle**: o primeiro botão da aba do diário abre a tela idle
- [ ] **Ajuste visual**: com 4 botões no diário, o rótulo "Commands" perde a última letra
- [x] **Painel resumido**: seção "Idle Information" no topo da aba do diário, com modo, atividade,
      XP por hora, pontos e tempo idle (atualiza a cada 2 segundos)
- [ ] **Painel na tela de jogo** (sobreposto, sem abrir a aba do diário), se o diário não bastar
- [x] **Tela ao logar com ganhos offline**: abre sozinha depois do Play, com o resumo da última vez
      fora
- [x] **Abas na tela idle**: Overview (status e melhorias), Stats e Travel; a aba **Loja** entra
      junto com a loja de Idle Coins
- [x] **Estatísticas, parte 1**: XP por hora da sessão e tempo idle total (online + offline);
      totais de XP e itens já são guardados (`idle-mode:totals`)
- [x] **Estatísticas, parte 2**: aba Stats com XP por skill, itens por tipo e tempo idle jogando
      e fora (os totais por skill e item contam a partir desta versão)
- [x] **Redesenho das seis abas** (PR #25, 05/11/2026): cada aba passa a ter uma coisa em
      destaque e todo número que é fração virou barra. Overview ganhou uma faixa com o que o
      personagem está fazendo (estado na sobrancelha e na cor da borda, auto-resume e XP/h ao
      lado); teto offline e última ausência viraram rodapé. Como nenhum pacote redimensiona nem
      recolore um componente, barra = trilho escuro com pips que acendem, e troca de cor =
      retângulos empilhados. Os redesenhos agora só enviam o que mudou
- [ ] **Versão mobile** conferida (o cliente já é responsivo; validar as telas idle no celular)

## P1 - Loja de Idle Coins

Uma moeda própria do jogo idle, separada dos pontos de melhoria.

- [ ] **Definir a moeda**: como se ganha Idle Coins (tempo idle, metas diárias, conquistas) e se
      os pontos atuais viram coins ou continuam separados
- [ ] **Loja de Idle Coins** (tela própria, no mesmo estilo das telas idle)
- [ ] **Item: Membership** - comprar dias de member com Idle Coins (o servidor já separa conteúdo
      F2P e de membros)
- [ ] **Item: mais horas offline** e **mais espaço no banco**
- [ ] **Item: boosts temporários** (ex.: +50% de XP por 1 hora)
- [ ] **Item: cosméticos** (roupas, pets, títulos)
- [ ] **Itens futuros**: reservar espaço na loja para o que vier depois
- [ ] **Atenção - dinheiro real**: se Idle Coins puderem ser comprados com dinheiro, isso é
      monetizar o conteúdo da Jagex, que é o maior risco jurídico do projeto. Ganhar coins só
      jogando é bem mais seguro.

## P1 - Conteúdo e equilíbrio

- [x] **Produção idle**: Cooking, Smithing, Fletching, Crafting e Herblore em ciclo automático,
      usando os materiais do banco (testado no jogo: cozinhar, fundir e fletching, online e offline)
- [x] **Locais de viagem para produção**: aba Making com fogões (Al Kharid, Catherby), fornalhas
      (Al Kharid, Edgeville) e o banco de Al Kharid
- [x] **Fogueira fixa** (bonfire) no Grand Exchange que nunca apaga: o personagem fica alimentando
- [x] **Firemaking e Thieving idle**: linha de fogueiras ou alimentar fogueira (reacende sozinho);
      bater carteira e barracas, com o saque no banco, aba Thieving na viagem (testado no jogo)
- [x] **Smithing na bigorna**: barra na bigorna e escolha o item; o personagem continua forjando
      com as barras do banco; local de viagem nas bigornas de Varrock (testado no jogo)
- [ ] **Mais locais de viagem**, incluindo áreas de membros
- [x] **Equilíbrio**: taxas medidas no jogo e economia de pontos revisadas (seção Balance em
      `docs/idle-mode.md`). Produção agora dá pontos idle (e Quick Hands acelera a produção); o
      progresso offline precisa de 2 minutos de amostra (antes 1)
- [x] **Metas diárias**: 3 por dia (aba Goals), que pagam pontos idle e um bônus por completar
      todas; contam online e offline
- [x] **Conquistas idle**: 5 trilhas com 3 níveis (Gatherer, Maker, Fighter, Patient, Dedicated),
      que pagam pontos idle; aba Feats

## P2 - Depois

- [x] Ranking (hiscores): XP idle, pontos idle ganhos e horas idle; aba Ranks na tela idle e `::idle top`
- [x] **No ar em https://jogo.stfu.fun** (05/11/2026): dois contêineres atrás do Traefik que
      já existe na VPS, HTTPS/WSS por Let's Encrypt, mundo idle ligado para contas novas e
      backup diário dos saves. Como publicar e atualizar: `docs/deploy/jogo-stfu-fun.md`
- [ ] Viagem andando em vez de teleporte, usando as rotas longas dos bots
- [x] Bosses idle: aba Bosses na viagem; Gemstone Crab (minera a casca e segue o caranguejo) e
      Scurrius; nível de combate exigido, come antes e foge quando a comida acaba; conquista e
      ranking de bosses
- [x] Giant Mole corrigida: depois de cavar ela fica onde saiu (antes voltava ao spawn curada e sem
      tomar dano); local de viagem na aba Bosses
- [x] Testes automáticos no GitHub em todo PR (`.github/workflows/server-tests.yml`): o job
      **Idle Mode** precisa passar; o **Full suite** roda todos os testes e só informa
- [ ] Corrigir as 84 falhas antigas da suíte completa (já falhavam antes do trabalho idle; nenhuma
      é do modo idle) e então fazer o **Full suite** bloquear também
- [x] Sincronizar com o projeto original (`git merge upstream/main`, PR #21, 05/11/2026): 225
      commits sem conflito, o fake de inventário dos testes ganhou `getAddableAmount` porque o
      Fletching novo o chama. A suíte completa foi de 13.587 testes / 68 falhas para 14.161 / 84 —
      o upstream consertou 20 falhas antigas e trouxe 17 novas, todas de conteúdo dele
- [ ] Voltar a sincronizar de tempos em tempos
