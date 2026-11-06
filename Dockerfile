FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV MONITOR_PORTA=8080 MONITOR_HOST=0.0.0.0
EXPOSE 8080
CMD ["python3", "servidor.py"]
