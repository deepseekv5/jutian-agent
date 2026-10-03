#!/usr/bin/env python3
"""Speech-to-text (faster-whisper)。
- 默认一次性：python3 stt.py <audio_path>
- 常驻服务（提速关键，模型只加载一次）：python3 stt.py --serve
  从 stdin 每行读一个 wav 路径，转写后向 stdout 打印 "RESULT\\t<文本>\\n"（异常 "ERR:\\t<原因>\\n"）。
"""
import sys
import os
from faster_whisper import WhisperModel

MODEL_SIZE = os.environ.get("WHISPER_MODEL", "tiny")
model = None


def get_model():
    global model
    if model is None:
        model = WhisperModel(
            MODEL_SIZE, device="cpu", compute_type="int8",
            cpu_threads=int(os.environ.get("WHISPER_THREADS", "4")),
        )
    return model


def transcribe(audio_path: str) -> str:
    m = get_model()
    # 提速参数：贪心解码(beam_size=1)、VAD 去静音、不依赖上文、锁中文跳过语言检测
    segments, _ = m.transcribe(
        audio_path, language="zh", beam_size=1,
        vad_filter=True, condition_on_previous_text=False,
    )
    return "".join(s.text for s in segments).strip()


def serve():
    get_model()  # 预热加载一次
    sys.stderr.write("READY\n")
    sys.stderr.flush()
    for line in sys.stdin:
        path = line.strip()
        if not path:
            continue
        try:
            text = transcribe(path).replace("\n", " ").replace("\t", " ")
            sys.stdout.write("RESULT\t" + text + "\n")
        except Exception as e:
            sys.stdout.write("ERR:\t" + str(e).replace("\n", " ") + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    if "--serve" in sys.argv:
        serve()
        sys.exit(0)
    if len(sys.argv) < 2:
        print("Usage: python3 stt.py <audio_path> [--serve]", file=sys.stderr)
        sys.exit(1)
    try:
        print(transcribe(sys.argv[1]))
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
