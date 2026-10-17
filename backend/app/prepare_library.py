from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import BinaryIO

from .library_builder import prepare_listen_resources


def _try_lock(data_root: Path) -> BinaryIO | None:
    """Keep npm run dev and a manual batch command from transcribing the same files twice."""
    data_root.mkdir(parents=True, exist_ok=True)
    handle = (data_root / '.prepare-library.lock').open('a+b')
    handle.seek(0, os.SEEK_END)
    if handle.tell() == 0:
        handle.write(b'\0')
        handle.flush()
    handle.seek(0)
    try:
        if os.name == 'nt':
            import msvcrt

            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        return None
    return handle


def main() -> None:
    parser = argparse.ArgumentParser(description='Transcribe Listen audio locally and build schema v3 exam packages.')
    parser.add_argument('--listen-root', type=Path, default=Path('Listen'))
    parser.add_argument('--data-root', type=Path, default=Path('backend/data'))
    parser.add_argument('--model-size', choices=('small', 'medium'), default='small')
    parser.add_argument('--reuse-only', action='store_true', help='Do not run Whisper when no matching result exists.')
    args = parser.parse_args()
    data_root = args.data_root.resolve()
    lock = _try_lock(data_root)
    if lock is None:
        print('[Listen] 已有一个本地题库处理任务正在运行，本次不重复启动。', flush=True)
        return
    try:
        resources = prepare_listen_resources(
            args.listen_root.resolve(),
            data_root,
            model_size=args.model_size,
            transcribe_missing=not args.reuse_only,
        )
        for resource in resources:
            print(f'[Listen] {resource.get("status")}: {resource.get("fileName")} — {resource.get("message")}', flush=True)
    finally:
        lock.close()


if __name__ == '__main__':
    main()
