.PHONY: help pages-init pages-build deploy-pages live
SHELL := /bin/bash

help:  ## list the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-14s %s\n", $$1, $$2}'

# --------- Radicle Pages --------- #

# The site is the whole content of the `pages` branch, which Radicle Pages
# serves. That branch is checked out once as an orphan worktree in `pages/`,
# so a deployment is a build copied there, committed and pushed.
override pages_dir = pages
override build_dir = dist

# The site has a domain of its own (git-pages reads the `_git-pages-repository` TXT
# record), so the build is for `/`. Served from the pages host instead, under its
# name: `make deploy-pages base=/stellar-stratum/`.
ifndef base
   override base = /
endif

# Where that build is served, so `make live` reads the site itself rather than
# what was last built. Another host: `make live site=https://example.com/`.
ifndef site
   override site = https://stellar-stratum.xyz/
endif

pages-init:  ## one-time: the canonical pages branch and the worktree that builds into it
	rad id update \
		--title "Configure the pages canonical branch" \
		--description "Radicle Pages serves the site from refs/heads/pages" \
		--payload xyz.radicle.crefs rules \
		'{"refs/heads/pages": {"allow": "delegates", "threshold": 1}}'
	rad sync
	git worktree add --orphan -b $(pages_dir) $(pages_dir)

pages-build:  ## build the site into the pages worktree and commit it there, without pushing
	@test -e $(pages_dir)/.git || { echo "run 'make pages-init' first"; exit 1; }
	@test -z "$$(git status --porcelain --untracked-files=no)" \
		|| { echo "commit first: a publish names the commit it was built from"; exit 1; }
	BASE_PATH=$(base) npm run build
	find $(pages_dir) -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
	cp -R $(build_dir)/. $(pages_dir)/
	git -C $(pages_dir) add -A
	git -C $(pages_dir) commit -q -m "Publish $(shell git rev-parse --short HEAD)" \
		|| echo "the build is identical, publishing it again"

deploy-pages: pages-build  ## build the site and publish it to Radicle Pages
	git -C $(pages_dir) push rad $(pages_dir)

# The entry bundles are hashed on their contents, so the live ones name the
# build. Against dist as `deploy-pages` leaves it: run this after a
# publish, or after the same build, or the hashes differ for reasons of their
# own.
live:  ## whether the published app is the build in dist/
	@diff <(curl -fsS $(site) | grep -o 'assets/[^"]*\.js' | sort -u) \
		<(grep -o 'assets/[^"]*\.js' $(build_dir)/index.html | sort -u) \
		&& echo "live is this build"
