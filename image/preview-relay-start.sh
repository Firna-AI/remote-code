#!/bin/sh
set -eu
exec "${1:-/opt/conductive/current/conductive}" relay
