FROM node:20

WORKDIR /workspace
COPY run-agent.sh /run-agent.sh

RUN apt-get update && apt-get install -y git curl

CMD ["bash", "/run-agent.sh"]
