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
- [ ] **Abas na tela idle**: Status, Melhorias, Viagem, Loja e Estatísticas, numa só janela
- [x] **Estatísticas, parte 1**: XP por hora da sessão e tempo idle total (online + offline);
      totais de XP e itens já são guardados (`idle-mode:totals`)
- [ ] **Estatísticas, parte 2**: uma aba que mostre os totais por skill e por item
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

- [ ] **Mais skills idle**: Cooking, Smithing, Fletching, Firemaking e Thieving em ciclo
      automático (produção usando o que está no banco)
- [ ] **Mais locais de viagem**, incluindo áreas de membros
- [ ] **Equilíbrio**: revisar taxas offline, limite de horas, preços das melhorias e quanto o
      jogador ganha por hora
- [ ] **Metas e conquistas idle**: objetivos diários e marcos de progresso

## P2 - Depois

- [ ] Ranking (hiscores) de pontos e XP idle
- [ ] Viagem andando em vez de teleporte, usando as rotas longas dos bots
- [ ] Bosses idle
- [ ] Testes automáticos rodando no GitHub em todo PR (CI)
- [ ] Sincronizar com o projeto original de tempos em tempos (`git merge upstream/main`)
