# Monitor de Sinal TV Digital – São Paulo

Sistema web que compara o nível de sinal de TV digital entre uma campanha de
referência (2018) e as medições novas (2026), mostrando onde o sinal melhorou
e onde piorou.

Telas: **Painel** (resumo e gráficos), **Mapa** (zoom, filtros por canal e
situação, busca de bairro, detalhes ao clicar), **Regiões** (tabela com busca,
ordenação e exportação CSV), **Ocorrências de piora** e **Metodologia**.

```
monitor-sinal/
├── processar.py          # lê os CSV e gera os dados do site
├── servidor.py           # servidor web (só Python 3, sem dependências)
├── install.sh            # instalador de um comando (systemd)
├── atualizar.sh          # reprocessa após copiar novos CSV
├── requirements.txt      # pandas e numpy (só para o processar.py)
├── dados/
│   ├── referencias.csv   # bairros usados para nomear as áreas (editável)
│   └── entrada/
│       ├── 2018/         # CSV da campanha de referência
│       └── 2026/         # CSV das medições novas (Dia01.csv, Dia02.csv, ...)
├── web/                  # o site (HTML, JS, CSS, d3 local e web/dados/*.json)
└── deploy/               # serviço systemd e exemplo de nginx
```

O pacote já vem com os dados processados (Dia01 a Dia23), então o site
funciona assim que é instalado.

## Instalação (um comando)

Num servidor Linux com systemd (Ubuntu, Debian, Rocky, Alma, Fedora…):

```bash
curl -fsSL https://raw.githubusercontent.com/BrunoTv01/monitor-sinal/main/install.sh | sudo bash
```

Pronto: o instalador baixa o projeto em `/opt/monitor-sinal`, instala o que
falta (git, Python), cria o serviço `monitor-sinal`, libera a porta no firewall
e mostra o endereço, por padrão `http://IP-DO-SERVIDOR:8080/`.

Com outra porta e com login:

```bash
curl -fsSL https://raw.githubusercontent.com/BrunoTv01/monitor-sinal/main/install.sh | sudo PORTA=80 USUARIO=admin SENHA=uma-senha-forte bash
```

**Atualizar o sistema** (depois de um novo commit no GitHub): rode o mesmo comando.

**Desinstalar:**

```bash
curl -fsSL https://raw.githubusercontent.com/BrunoTv01/monitor-sinal/main/install.sh | sudo bash -s -- --desinstalar
```

Comandos úteis: `sudo systemctl status monitor-sinal`, `sudo journalctl -u monitor-sinal -f`.

O fundo **OpenStreetMap** do mapa é baixado pelo navegador de quem acessa; sem
internet, escolha o fundo **Só trajetos**, que funciona offline.

## Testar sem instalar

```bash
python3 servidor.py --porta 8080
# abra http://localhost:8080/
```

## Atualizar com novas medições

1. Copie os novos CSV (mesmo formato do medidor) para `dados/entrada/2026/`
   (no servidor: `/opt/monitor-sinal/dados/entrada/2026/`).
2. Rode:
   ```bash
   sudo /opt/monitor-sinal/atualizar.sh
   ```
3. Recarregue a página. Não precisa reiniciar o serviço.

Opções do processamento:

```bash
python3 processar.py --ref dados/entrada/2018 --novo dados/entrada/2026
python3 processar.py --unificar dados/unificado_2026.csv   # também grava todos os dias num CSV só
python3 processar.py --rotulo-ref 2018 --rotulo-novo 2027  # para uma campanha futura
```

Os parâmetros da análise (margem de ±3 dB para "estável", faixas Bom/Médio/
Limítrofe, tamanho das áreas) ficam no topo do `processar.py`.

## Login (opcional)

Passe `USUARIO=... SENHA=...` no comando de instalação (veja acima); para trocar
depois, rode o comando de novo com os novos valores.
Para acesso pela internet, use HTTPS (nginx + Let's Encrypt), porque o login
simples envia a senha sem criptografia em HTTP.

## Com nginx

`deploy/nginx.conf` traz duas opções: o nginx servindo a pasta `web/` direto
(não precisa do `servidor.py`) ou o nginx na frente do serviço na porta 8080.
Para HTTPS: `sudo certbot --nginx -d monitor.seudominio.com.br`.

## Com Docker

```bash
docker compose up -d --build                         # http://localhost:8080
docker compose run --rm monitor-sinal python3 processar.py   # após novos CSV
```

## Formato dos CSV

Separador `;`, decimal `,`, UTF-8, colunas
`CH;layer;freq;guard interval;NIVEL;C/N;MER;CBER;VBER;Date;Hour;LAT;LONG;SINAL`,
com LAT/LONG em graus e minutos decimais (ex.: `-23°32.9899`). Leituras com
NIVEL igual a 0 são descartadas.

## Observações

- Comparação só dos canais medidos nas duas campanhas (hoje C24, C38 e C39).
- Variações menores que 3 dB contam como estáveis, porque equipamento e
  calibração podem ter mudado entre as campanhas.
- Os nomes de bairro são o ponto de `dados/referencias.csv` mais próximo de
  cada área: são aproximados. Dá para editar ou acrescentar bairros nesse
  arquivo e rodar `atualizar.sh`.
- Mapa: © colaboradores do OpenStreetMap. Respeite a política de uso dos tiles
  (https://operations.osmfoundation.org/policies/tiles/); para uso intenso,
  troque a URL em `web/app.js` por um servidor de tiles próprio ou contratado.
