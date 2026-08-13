#!/usr/bin/env python3
"""Relaye un TUI dans un pseudo-terminal en remplaçant une couleur RGB précise."""

from __future__ import annotations

import argparse
import errno
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios


def rgb(value: str) -> tuple[int, int, int]:
    value = value.removeprefix("#")
    if len(value) != 6:
        raise argparse.ArgumentTypeError("couleur attendue au format #RRGGBB")
    try:
        return tuple(int(value[index : index + 2], 16) for index in (0, 2, 4))
    except ValueError as error:
        raise argparse.ArgumentTypeError("couleur attendue au format #RRGGBB") from error


def copy_window_size(source: int, target: int) -> None:
    try:
        size = fcntl.ioctl(source, termios.TIOCGWINSZ, struct.pack("HHHH", 0, 0, 0, 0))
        fcntl.ioctl(target, termios.TIOCSWINSZ, size)
    except OSError:
        pass


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--from-color", type=rgb, required=True)
    parser.add_argument("--to-color", type=rgb, required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("commande manquante après --")

    old = args.from_color
    new = args.to_color
    replacements = {
        f"\x1b[48;2;{old[0]};{old[1]};{old[2]}m".encode():
        f"\x1b[48;2;{new[0]};{new[1]};{new[2]}m".encode(),
        f"\x1b[48:2::{old[0]}:{old[1]}:{old[2]}m".encode():
        f"\x1b[48:2::{new[0]}:{new[1]}:{new[2]}m".encode(),
    }
    sources = tuple(replacements)

    def transform(data: bytes, pending: bytes) -> tuple[bytes, bytes]:
        """Transforme les séquences complètes et ne retient qu'un préfixe incomplet."""
        buffer = pending + data
        output = bytearray()
        while buffer:
            escape = buffer.find(b"\x1b")
            if escape < 0:
                output.extend(buffer)
                buffer = b""
                break
            if escape > 0:
                output.extend(buffer[:escape])
                buffer = buffer[escape:]
                continue
            for source, target in replacements.items():
                if buffer.startswith(source):
                    output.extend(target)
                    buffer = buffer[len(source) :]
                    break
            else:
                if any(source.startswith(buffer) for source in sources):
                    break
                output.append(buffer[0])
                buffer = buffer[1:]
                continue
            continue
        return bytes(output), buffer

    child_pid, master = pty.fork()
    if child_pid == 0:
        os.execvp(command[0], command)

    stdin_fd = sys.stdin.fileno()
    stdout_fd = sys.stdout.fileno()
    original_terminal = termios.tcgetattr(stdin_fd) if os.isatty(stdin_fd) else None
    if original_terminal:
        tty_mode = termios.tcgetattr(stdin_fd)
        tty_mode[3] &= ~(termios.ECHO | termios.ICANON | termios.IEXTEN | termios.ISIG)
        tty_mode[0] &= ~(termios.IXON | termios.ICRNL)
        termios.tcsetattr(stdin_fd, termios.TCSANOW, tty_mode)

    copy_window_size(stdin_fd, master)
    signal.signal(signal.SIGWINCH, lambda *_: copy_window_size(stdin_fd, master))
    signal.signal(signal.SIGTERM, lambda *_: os.kill(child_pid, signal.SIGTERM))
    pending = b""
    input_open = True

    try:
        while True:
            inputs = [master]
            if input_open:
                inputs.append(stdin_fd)
            readable, _, _ = select.select(inputs, [], [])
            if input_open and stdin_fd in readable:
                data = os.read(stdin_fd, 65536)
                if not data:
                    input_open = False
                else:
                    os.write(master, data)
            if master in readable:
                try:
                    data = os.read(master, 65536)
                except OSError as error:
                    if error.errno == errno.EIO:
                        break
                    raise
                if not data:
                    break
                output, pending = transform(data, pending)
                if output:
                    os.write(stdout_fd, output)
    finally:
        if pending:
            for source, target in replacements.items():
                pending = pending.replace(source, target)
            os.write(stdout_fd, pending)
        if original_terminal:
            termios.tcsetattr(stdin_fd, termios.TCSANOW, original_terminal)

    _, status = os.waitpid(child_pid, 0)
    return os.waitstatus_to_exitcode(status)


if __name__ == "__main__":
    raise SystemExit(main())
