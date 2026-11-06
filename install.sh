#!/usr/bin/env bash
# =============================================================================
#  Monitor de Sinal TV Digital - instalador de um comando
#
#  Instalar ou atualizar:
#    curl -fsSL https://raw.githubusercontent.com/BrunoTv01/monitor-sinal/main/install.sh | sudo bash
#
#  Com opções (porta, login):
#    curl -fsSL https://raw.githubusercontent.com/BrunoTv01/monitor-sinal/main/install.sh | sudo PORTA=80 USUARIO=admin SENHA=minhasenha bash
#
#  Sem curl (ex.: Debian mínimo):
#    wget -qO- https://raw.githubusercontent.com/BrunoTv01/monitor-sinal/main/install.sh | sudo bash
#
#  Desinstalar:
#    curl -fsSL https://raw.githubusercontent.com/BrunoTv01/monitor-sinal/main/install.sh | sudo bash -s -- --desinstalar
# =============================================================================
set -Eeuo pipefail
LOG=/var/log/monitor-sinal-install.log

REPO="${REPO:-https://github.com/BrunoTv01/monitor-sinal.git}"
BRANCH="${BRANCH:-main}"
DESTINO="${DESTINO:-/opt/monitor-sinal}"
PORTA="${PORTA:-8080}"
USUARIO="${USUARIO:-}"
SENHA="${SENHA:-}"
SERVICO=monitor-sinal
CONTA=monitor

azul() { printf '\033[1;34m>> %s\033[0m\n' "$*"; }
erro() { printf '\033[1;31m!! %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || erro "Rode como root: curl ... | sudo bash   (se não tiver sudo, entre como root com: su -)"
exec > >(tee -a "$LOG") 2>&1
trap 'printf "\033[1;31m!! Falhou na linha %s: %s\033[0m\n!! Log completo em %s\n" "$LINENO" "$BASH_COMMAND" "$LOG" >&2' ERR
echo "===== $(date) - instalação do Monitor de Sinal =====" >> "$LOG"

# ---------------------------------------------------------------- desinstalar
if [[ "${1:-}" == "--desinstalar" ]]; then
  azul "Removendo o serviço e os arquivos"
  systemctl disable --now "$SERVICO" 2>/dev/null || true
  rm -f "/etc/systemd/system/$SERVICO.service"
  systemctl daemon-reload
  rm -rf "$DESTINO"
  id "$CONTA" >/dev/null 2>&1 && userdel "$CONTA" 2>/dev/null || true
  azul "Desinstalado."
  exit 0
fi

# ---------------------------------------------------------------- pacotes do sistema
azul "Instalando dependências do sistema (git, python3)"
if command -v apt-get >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  APT="apt-get -o DPkg::Lock::Timeout=600 -o Acquire::Retries=3"
  if pgrep -x unattended-upgr >/dev/null 2>&1 || pgrep -x apt >/dev/null 2>&1; then
    azul "O sistema está fazendo atualizações automáticas; aguardando terminar (pode levar alguns minutos)..."
  fi
  $APT update -qq || azul "aviso: apt update deu erro, tentando instalar mesmo assim"
  $APT install -y -qq git python3 python3-venv python3-pip curl ca-certificates
  $APT install -y -qq python3-pandas >/dev/null 2>&1 || true
elif command -v dnf >/dev/null; then
  dnf install -y -q git python3 python3-pip
  dnf install -y -q python3-pandas >/dev/null 2>&1 || true
elif command -v yum >/dev/null; then
  yum install -y -q git python3 python3-pip
elif command -v zypper >/dev/null; then
  zypper -q install -y git python3 python3-pip
elif command -v pacman >/dev/null; then
  pacman -Sy --noconfirm --needed git python python-pip
elif command -v apk >/dev/null; then
  apk add --no-cache git python3 py3-pip bash
else
  command -v git >/dev/null && command -v python3 >/dev/null || erro "Instale git e python3 manualmente e rode de novo."
fi
command -v systemctl >/dev/null || erro "Este instalador usa systemd. Sem systemd, use Docker (veja o README)."
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 7) else 1)' \
  || erro "Precisa de Python 3.7 ou mais novo (este tem $(python3 -V 2>&1)). Atualize o sistema."
if command -v ss >/dev/null && ss -ltnH "( sport = :$PORTA )" 2>/dev/null | grep -q . && ! systemctl is-active -q "$SERVICO" 2>/dev/null; then
  erro "A porta $PORTA já está em uso por outro programa. Escolha outra: curl ... | sudo PORTA=8090 bash"
fi

# ---------------------------------------------------------------- código
if [[ -d "$DESTINO/.git" ]]; then
  azul "Atualizando o código em $DESTINO"
  git -C "$DESTINO" fetch -q origin "$BRANCH"
  git -C "$DESTINO" reset -q --hard "origin/$BRANCH"
else
  azul "Baixando $REPO em $DESTINO"
  [[ -e "$DESTINO" ]] && mv "$DESTINO" "$DESTINO.bak.$(date +%s)"
  git clone -q --depth 1 -b "$BRANCH" "$REPO" "$DESTINO" \
    || erro "Não consegui baixar $REPO. A VM tem acesso à internet/GitHub?"
fi
git config --global --add safe.directory "$DESTINO" 2>/dev/null || true

# ---------------------------------------------------------------- python (só para reprocessar dados)
azul "Preparando o ambiente Python"
python3 -m venv --system-site-packages "$DESTINO/.venv" 2>/dev/null || python3 -m venv "$DESTINO/.venv" || true
if [[ -x "$DESTINO/.venv/bin/python" ]] && ! "$DESTINO/.venv/bin/python" -c "import pandas, numpy" 2>/dev/null; then
  "$DESTINO/.venv/bin/pip" install -q -r "$DESTINO/requirements.txt" \
    || echo "   (aviso: pandas/numpy não instalados; o site funciona, só o reprocessamento depende deles)"
fi

# ---------------------------------------------------------------- usuário e permissões
id "$CONTA" >/dev/null 2>&1 || useradd --system --home "$DESTINO" --shell /usr/sbin/nologin "$CONTA" 2>/dev/null \
  || useradd -r -d "$DESTINO" -s /sbin/nologin "$CONTA"
mkdir -p "$DESTINO/dados/entrada/2026"
chown -R "$CONTA:$CONTA" "$DESTINO"

# ---------------------------------------------------------------- serviço
azul "Configurando o serviço $SERVICO (porta $PORTA)"
PY=$(command -v python3)
{
  cat <<EOF
[Unit]
Description=Monitor de Sinal TV Digital
After=network.target

[Service]
Type=simple
User=$CONTA
Group=$CONTA
WorkingDirectory=$DESTINO
Environment=MONITOR_PORTA=$PORTA
Environment=MONITOR_HOST=0.0.0.0
EOF
  if [[ -n "$USUARIO" && -n "$SENHA" ]]; then
    echo "Environment=MONITOR_USUARIO=$USUARIO"
    echo "Environment=MONITOR_SENHA=$SENHA"
  fi
  cat <<EOF
ExecStart=$PY $DESTINO/servidor.py
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$DESTINO/web/dados
ProtectHome=true
PrivateTmp=true
EOF
  [[ "$PORTA" -lt 1024 ]] && echo "AmbientCapabilities=CAP_NET_BIND_SERVICE"
  cat <<EOF

[Install]
WantedBy=multi-user.target
EOF
} > "/etc/systemd/system/$SERVICO.service"
chmod 600 "/etc/systemd/system/$SERVICO.service"
systemctl daemon-reload
systemctl enable -q "$SERVICO"
systemctl restart "$SERVICO"
sleep 1

# ---------------------------------------------------------------- firewall
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow "$PORTA/tcp" >/dev/null && azul "Porta $PORTA liberada no ufw"
elif command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then
  firewall-cmd -q --add-port="$PORTA/tcp" --permanent && firewall-cmd -q --reload && azul "Porta $PORTA liberada no firewalld"
fi

# ---------------------------------------------------------------- fim
OK=0
for i in 1 2 3 4 5; do
  if systemctl is-active -q "$SERVICO" && { ! command -v curl >/dev/null || curl -s -o /dev/null "http://127.0.0.1:$PORTA/" ${USUARIO:+-u "$USUARIO:$SENHA"}; }; then OK=1; break; fi
  sleep 1
done
if [[ $OK -eq 1 ]]; then
  IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  echo
  azul "Monitor de Sinal no ar:  http://${IP:-SEU_SERVIDOR}:$PORTA/"
  [[ -n "$USUARIO" && -n "$SENHA" ]] && azul "Login: $USUARIO / (a senha que você definiu)"
  echo "   Novas medições: copie os CSV para $DESTINO/dados/entrada/2026 e rode  sudo $DESTINO/atualizar.sh"
  echo "   Atualizar o sistema: rode o mesmo comando de instalação de novo."
  echo "   Se não abrir de outro computador: verifique o firewall da nuvem/VM (porta $PORTA liberada para entrada)."
else
  journalctl -u "$SERVICO" -n 20 --no-pager || true
  erro "O serviço não subiu. Veja o log acima."
fi
