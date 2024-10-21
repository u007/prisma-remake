.PHONY: log dist
include .env

test:
	clear && bun test --serial --bail
