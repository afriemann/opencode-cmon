FROM oven/bun@sha256:cafb038ad9ebf08d42914f8af35a7b0b825655ad4046ea3470f5ef4f714f3325 AS bun
FROM node@sha256:8607a9064d4a571140998ae9e52a3b3fcf9cff361d04642d5971e6cd76d39e27 AS node
FROM python@sha256:8cdd496996889eef0a8a7921c152c0a4a9f18a26c7a5e7257d3c90b431891894
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=node /usr/local/bin/node /usr/local/bin/node
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx
RUN python - <<'PY'
import base64, hashlib, io, pathlib, tarfile, urllib.request
url = 'https://registry.npmjs.org/@opencode/cli-linux-x64-baseline/-/cli-linux-x64-baseline-2.0.24.tgz'
data = urllib.request.urlopen(url, timeout=60).read()
expected = 'dGa99UyGYS46alr6uxgaSKKHa/CtGgTlWdse1bbhNjLomeOhdIJVJwwxVKfFQz4/NDg1SzDXbxgcIXha2QYHPg=='
assert base64.b64encode(hashlib.sha512(data).digest()).decode() == expected, 'host integrity mismatch'
with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
    files = [m for m in archive.getmembers() if m.isfile()]
    print('artifact members:', [m.name for m in files])
    binary = [m for m in files if m.name.endswith('/bin/opencode')]
    assert len(binary) == 1, 'unexpected host executable layout'
    target = pathlib.Path('/usr/local/bin/opencode')
    target.write_bytes(archive.extractfile(binary[0]).read())
    target.chmod(0o755)
PY
RUN printf '%s\n' \
 'pyte==0.8.2 --hash=sha256:85db42a35798a5aafa96ac4d8da78b090b2c933248819157fc0e6f78876a0135' \
 'wcwidth==0.2.13 --hash=sha256:3da69048e4540d84af32131829ff948f1e022c1c6bdb8d6102117aac784f6859' > /opt/terminal-requirements.txt \
 && timeout -k 5s 90s python -m pip install --disable-pip-version-check --no-cache-dir --only-binary=:all: --require-hashes -r /opt/terminal-requirements.txt
ENV HOME=/work/home XDG_CONFIG_HOME=/work/config XDG_DATA_HOME=/work/data XDG_STATE_HOME=/work/state XDG_CACHE_HOME=/work/cache TMPDIR=/work/tmp BUN_INSTALL_CACHE_DIR=/work/cache/bun TERM=xterm-256color COLORTERM=truecolor
COPY source/ /opt/candidate/
WORKDIR /opt/candidate
RUN mkdir -p /work/tmp && timeout -k 5s 180s bun install --frozen-lockfile --ignore-scripts \
 && timeout -k 5s 180s bun run build \
 && sha256sum bun.lock dist/index.js dist/tui.js /usr/local/bin/opencode /usr/local/bin/bun /usr/local/bin/node > /opt/artifacts.sha256 \
 && rm -rf /work/*
WORKDIR /work
