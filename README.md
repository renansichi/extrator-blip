# Extrator Blip

Projeto TypeScript/Node.js para exportação sequencial, somente leitura, de configurações e fluxos do portal `macro.blip.ai`.

## Executar

Requer Node.js 22 ou superior e Microsoft Edge instalado. O Edge é o padrão porque o Chromium baixado apresentou `spawn UNKNOWN` neste computador.

```powershell
npm ci
npm run check
npm test
npm start -- --router vivofixacarrinho4router --config blip.config.json
```

Sem `--router`, a execução pergunta o identificador. URLs do router também são aceitas. `npm start` carrega automaticamente `blip.config.json`; `--config` seleciona outro arquivo. Arquivo ausente gera `CONFIGURACAO_NAO_ENCONTRADA` antes de abrir o navegador.

`blip.config.json` contém o adaptador local inspecionado e fica fora do versionamento. Para outra instalação, copie `blip.config.example.json`, inspecione os controles reais e só então habilite as opções `variablesVerified`, `variablesComplete` e `staticListingVerified`. A última opção só serve para a estrutura estática `.services-list` observada; outras listagens devem usar total, indicador de fim, paginação ou contêiner de rolagem verificados. Ausência de evidência deixa a descoberta inconclusiva.

As credenciais fornecidas foram configuradas em `.env`, com acesso local restrito ao usuário e exclusão de versionamento. Não compartilhe esse arquivo, `.auth` ou `saida`: podem conter dados sensíveis. O modo automático usa `BLIP_EMAIL` e `BLIP_PASSWORD`; o modo manual é selecionado por `manualLogin: true`. MFA ou CAPTCHA exigem intervenção no navegador e Enter no terminal. Erro explícito de autenticação deve ser configurado em `selectors.authError`, sem insistência com a mesma senha.

Login observado: componentes com Shadow DOM, email em `#email-input input`, senha em `#password-input input` e botão `#login-button`. O seletor `#password` do planejamento aponta a outro campo do documento e não deve ser usado no adaptador observado. O indicador autenticado é `.services-list`, combinado com a origem e a URL da página do router. `#buttonMenuUser` aparece duas vezes na árvore consultada pelo Playwright e causa `SELETOR_AMBIGUO`; não deve ser usado. A inicialização espera a listagem ou o formulário de login renderizarem antes de decidir se a sessão salva está válida.

## Resultados e retomada

Cada execução cria `saida/{router-seguro}/{run-id}/manifesto.json`. Para cada bot concluído, publica uma pasta como unidade em `bots/{bot-seguro}/` contendo:

- `fluxo-{bot-seguro}.json` com o contrato completo;
- `{bot-seguro}-Variaveis_de_configuracao.json` com a lista de variáveis.

O original fica em `originais/{bot-seguro}/tentativa-{n}/export-original.json`. Nomes seguros levam um hash estável para evitar colisões Windows. O manifesto registra caminhos, hashes SHA-256, tamanhos, tentativas e estados. Números do export usam parser e serialização sem perda de precisão.

```powershell
npm start -- --router vivofixacarrinho4router --config blip.config.json --resume "CAMINHO_ABSOLUTO_DA_EXECUCAO"
```

A retomada confere identidade e hashes dos arquivos concluídos, preserva publicações inconsistentes em `temporarios` e reprocessa o bot. Arquivos de retomada devem ser locais e confiáveis. `.execution.lock` impede duas execuções simultâneas; depois de término abrupto que não execute a limpeza, confirme que não há processo ativo antes de remover esse arquivo manualmente.

Há uma tentativa inicial e três repetições, com 10 segundos entre elas. O orçamento é por coleta de bot, sem repetições aninhadas: cada repetição usa nova página e novo diretório de download. Uma falha individual permite continuar os outros bots; disco, autenticação global ou incompatibilidade confirmada interrompem o lote. Ctrl+C fecha o navegador e salva o manifesto. Códigos de saída: 0 completa, 2 parcial, 1 falha ou cancelamento.

## Evidências e limites desta implementação

Em 02/11/2026, o router solicitado já estava autenticado no Edge conectado. Foram observados 13 links de bots em uma listagem estática Angular `ng-repeat`, sem controles de paginação na estrutura inspecionada. As URLs reais usam `/application/detail/{bot}/dashboard/general`, e o link do builder usa `/application/detail/{bot}/templates/builder`. Ambos foram incorporados ao parser explicitamente, mantendo também o padrão do planejamento.

No piloto `vivofixadados`, foram encontrados 22 componentes de variáveis. Foram comparados atributos e inputs de amostra, confirmando os seletores `input[name=key]` e `input[name=value]`; a implementação lê as propriedades atuais. Foram confirmados o identificador, o formulário e a ação `li[ng-click='$ctrl.exportFlow()']`, na aba **Versões**. O adaptador abre essa aba e aguarda a ação ficar visível antes de exportar. Nenhuma configuração foi alterada ou publicada.

A primeira execução independente não confirmou o login devido à ambiguidade de `#buttonMenuUser`. O erro era indevidamente convertido em pedido de intervenção e, em outra etapa, em erro não classificado. A correção foi reproduzida com login automático real e teste de regressão com menus duplicados e renderização tardia. Erros de seletor agora encerram com diagnóstico explícito, em vez de solicitar MFA sem evidência.

O teste integrado usa um arquivo sintético em uma URL `data:` para verificar captura de download, persistência e identidade, sem depender de uma resposta de download simulada por interceptação de rede. A suíte completa inclui login, sessão salva com renderização tardia, paginação, snapshot, download, publicação, hashes, precisão e repetição.

Formatos ZIP e codificações diferentes de UTF-8 são recusados explicitamente. Variáveis virtualizadas exigem adaptador específico; o adaptador atual só cobre o formulário estático inspecionado. Exportar objeto JSON válido não comprova sozinho a identidade interna do fluxo: não foi inventado um campo de identidade do export. A associação usa página exclusiva, URL verificada e evento originado na mesma página.

Referências de implementação: [downloads](https://playwright.dev/docs/downloads) e [autenticação](https://playwright.dev/docs/auth) na documentação oficial do Playwright.

## Diagnóstico de execução

Validação real concluída em 02/11/2026 com o router `vivofixacarrinho4router`: **13 bots descobertos, 13 concluídos, zero falhas**. A execução retomada terminou com status `concluida` em `saida/vivofixacarrinho4router-24ab0eb9694d/2026-11-02T04-26-43-071Z-e44c3a22/manifesto.json`. Foram produzidos 26 JSONs finais e 13 originais associados, com verificação de hashes e comparação do fluxo publicado com o JSON original. Os oito testes automatizados, a checagem de tipos e a compilação passaram.

- `CONFIGURACAO_NAO_ENCONTRADA`: copie e adapte o exemplo ou selecione um arquivo com `--config`.
- `AUTENTICACAO_SELETOR_AMBIGUO` / `SELETOR_AMBIGUO`: o indicador encontra mais de um elemento; corrija o seletor. Não representa senha incorreta nem pedido de MFA.
- `AUTENTICACAO_TELA_NAO_RECONHECIDA`: nem a listagem autenticada nem o formulário de login ficaram visíveis dentro do prazo.
- `TERMINAL_ENTRADA_FECHADA`: o terminal não aceita mais a resposta da etapa manual; execute em um terminal interativo ou configure login automático.
- `NAVEGADOR_OU_ABA_FECHADO`: a janela controlada foi fechada antes do término.
- `LOGIN_RETORNO_TIMEOUT`: o login não retornou ao domínio esperado dentro do prazo.

O terminal mostra o caminho do manifesto ao interromper. Esse arquivo contém códigos e estados, sem valores de configurações ou credenciais. No modo manual, mantenha a janela do extrator aberta depois de concluir o login.
