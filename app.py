import os
import sys
import time
import tempfile
import logging
import gradio as gr

from typing import Union, Literal
from openai import OpenAI
from dotenv import load_dotenv
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# 设置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger()
logger.setLevel(logging.INFO)

console_handler = logging.StreamHandler()
console_handler.setLevel(logging.INFO)
console_handler.setFormatter(logging.Formatter("[%(levelname)s] %(message)s"))
logger.addHandler(console_handler)
load_dotenv()
logging.info("环境变量已加载。")

# 读取环境变量
server_name = os.getenv("SERVER_NAME", "tts.happys.icu")
openai_key = os.getenv("OPENAI_KEY")
openai_base_url = os.getenv("OPENAI_BASE_URL")
logging.info("从环境变量中读取服务器名称和OpenAI密钥以及请求地址。")

if openai_key == "<YOUR_OPENAI_KEY>":
    openai_key = ""
if openai_key == "":
    sys.exit("请提供您的OpenAI API密钥。")
logging.info("OpenAI API密钥已设置。")

# 定义一个简单的限流器
class RateLimiter:
    def __init__(self, max_calls, period):
        self.calls = []
        self.max_calls = max_calls
        self.period = period

    def attempt(self):
        now = time.time()
        self.calls = [call for call in self.calls if call > now - self.period]
        if len(self.calls) < self.max_calls:
            self.calls.append(now)
            return True
        return False

tts_rate_limiter = RateLimiter(max_calls=5, period=30)

def tts(
        text: str,
        model: Union[str, Literal["tts-1", "tts-1-hd"]],
        voice: Literal["alloy", "echo", "fable", "onyx", "nova", "shimmer"],
        output_file_format: Literal["mp3", "opus", "aac", "flac"] = "mp3",
        speed: float = 1.0,
        custom_file_name: str = None  # 添加自定义文件名参数
):
    # 检查限流器
    if not tts_rate_limiter.attempt():
        raise gr.Error("超出请求频率限制，请稍后再试。")

    file_name = custom_file_name if custom_file_name else tempfile.mktemp(suffix=f".{output_file_format}")
    # 确保文件保存到 /finish 文件夹
    file_name = os.path.join("finish", file_name)
    logging.info(f"正在写入语音文件到：{file_name}")
    with open(file_name, "wb") as file:
        file.write(response.content)
    return file_name
    
    logging.info(f"接收到文本：{text}")
    if len(text) > 0:
        try:
            logging.info("正在请求OpenAI API进行文本转语音...")
            client = OpenAI(api_key=openai_key, base_url=openai_base_url)
            response = client.audio.speech.create(
                model=model,
                voice=voice,
                input=text,
                response_format=output_file_format,
                speed=speed
            )
            logging.info("语音合成请求成功！")
        except Exception as error:
            logging.error(str(error))
            raise gr.Error("生成语音时出现错误，请检查API密钥并重试。")

        file_name = custom_file_name if custom_file_name else tempfile.mktemp(suffix=f".{output_file_format}")
        logging.info(f"正在写入语音文件到：{file_name}")
        with open(file_name, "wb") as file:
            file.write(response.content)
        return file_name
    else:
        logging.info("无文本输入，返回默认静音文件。")
        return "1-second-of-silence.mp3"

def wrap_tts(
    text: str, 
    model: str = "tts-1", 
    voice: str = "alloy", 
    output_file_format: str = "mp3", 
    speed: float = 1.0, 
    custom_file_name: str = ""
):
    # 如果提供了自定义文件名并且它没有后缀，或者后缀不正确
    if custom_file_name and not custom_file_name.endswith(f'.{output_file_format}'):
        # 从自定义文件名中移除现有的文件扩展名（如果有的话），并添加正确的扩展名
        base_name = os.path.splitext(custom_file_name)[0]
        custom_file_name = f"{base_name}.{output_file_format}"

    # 调用修改后的tts函数
    file_name = tts(
        text=text, 
        model=model, 
        voice=voice, 
        output_file_format=output_file_format, 
        speed=speed, 
        custom_file_name=custom_file_name if custom_file_name else None
    )
    return file_name

class ChangeHandler(FileSystemEventHandler):
    """文件修改事件处理器，用于重新加载服务器。"""
    
    def on_modified(self, event):
        # 如果是Python脚本文件或环境变量文件被修改，重启服务器
        if event.src_path == "你的脚本.py" or event.src_path == ".env":
            print(f"检测到文件变化: {event.src_path}")
            os.execv(sys.executable, ['python'] + sys.argv)  # 重启脚本

iface = gr.Interface(
    fn=wrap_tts,
    inputs=[
        gr.Textbox(label="文本"),
        gr.Dropdown(choices=["tts-1", "tts-1-hd"], label="模型", value="tts-1-hd"),
        gr.Radio(choices=["alloy", "echo", "fable", "onyx", "nova", "shimmer"], label="声音", value="nova"),
        gr.Dropdown(choices=["mp3", "opus", "aac", "flac"], label="输出文件格式", value="mp3"),
        gr.Slider(minimum=0.5, maximum=2.0, step=0.1, value=1.0, label="速度"),
        gr.Textbox(label="自定义文件名（可选）", value="")
    ],
    outputs=gr.Audio(label="预览音频", type="filepath", autoplay=True),
    title="Happy 文本转语音",
    description="输入文本并选择选项以生成语音。你也可以指定一个自定义的文件名。",
    css="""footer.svelte-mpyp5e { display: none !important; }"""
)

if __name__ == '__main__':
    if not os.path.exists("finish"):
     os.makedirs("finish")
    # 设置监视当前目录的观察者
    path = '.'  # 你希望监控的目录
    event_handler = ChangeHandler()  # 创建文件变动事件处理器的实例
    observer = Observer()  # 创建观察者实例
    observer.schedule(event_handler, path, recursive=False)  # 安排观察者监视指定路径的事件处理器
    observer.start()  # 启动观察者

    try:
        # 启动Gradio界面
        iface.launch(share=False)
        
        # 创建一个无限循环，以保持脚本运行
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()  # 如果有键盘中断，停止观察者
    observer.join()  # 清理观察者线程