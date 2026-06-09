# Go Rootfs

This directory contains the v1 Go runtime asset skeleton.

Build the image:

```sh
docker build -f wurzelwerk/go/Dockerfile -t sandkasten/go-rootfs:1.26 .
```

Export a rootfs tarball for runner experiments:

```sh
container="$(docker create sandkasten/go-rootfs:1.26)"
docker export "$container" -o wurzelwerk/go/go-rootfs-1.26.tar
docker rm "$container"
```

Notes:

- Jobs are expected to build with `-mod=vendor`.
- The image contains the Go toolchain and basic CA/timezone data.
- Do not add package managers, credentials, or host-specific config to production rootfs artifacts.
- Generated tarballs are ignored by `.gitignore`.
