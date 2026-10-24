FROM oven/bun@sha256:cafb038ad9ebf08d42914f8af35a7b0b825655ad4046ea3470f5ef4f714f3325 AS bun
FROM node@sha256:8607a9064d4a571140998ae9e52a3b3fcf9cff361d04642d5971e6cd76d39e27
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx
WORKDIR /work
