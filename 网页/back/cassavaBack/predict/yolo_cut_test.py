import os
import cv2
import numpy as np
from ultralytics import YOLO

# 配置
MODEL1_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../模型/yolov11/yolo11n.pt'))
MODEL2_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../模型/yolov11/yolo11m-seg.pt'))
IMAGE_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), 'S15 (1).jpg'))  # 替换为你的图片路径
CONFIDENCE = 0.3
OUTPUT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), 'yolo_cut_test_results'))
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 加载模型
yolo1 = YOLO(MODEL1_PATH)
yolo2 = YOLO(MODEL2_PATH)

# 读取图片
img = cv2.imread(IMAGE_PATH)
if img is None:
    print(f'无法读取图片: {IMAGE_PATH}')
    exit(1)
img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

# 第一次分割
detections = yolo1(IMAGE_PATH, conf=CONFIDENCE, save=False)
if detections and len(detections) > 0:
    boxes = detections[0].boxes
    print(f'第一次分割检测到的目标数: {len(boxes)}')
    cut_imgs = []
    for i, box in enumerate(boxes.xyxy):
        x1, y1, x2, y2 = map(int, box.cpu().numpy())
        cut_img = img_rgb[y1:y2, x1:x2].copy()
        cut_path = os.path.join(OUTPUT_DIR, f'cut1_{i+1}.png')
        cv2.imwrite(cut_path, cv2.cvtColor(cut_img, cv2.COLOR_RGB2BGR))
        print(f'已保存第{i+1}个切割区域: {cut_path}')
        cut_imgs.append((cut_img, cut_path))
else:
    print('第一次分割未检测到任何目标')
    exit(1)

# 第二次分割
for idx, (cut_img, cut_path) in enumerate(cut_imgs):
    temp_path = os.path.join(OUTPUT_DIR, f'temp_cut1_{idx+1}.png')
    cv2.imwrite(temp_path, cv2.cvtColor(cut_img, cv2.COLOR_RGB2BGR))
    detections2 = yolo2(temp_path, conf=CONFIDENCE, save=False)
    if detections2 and len(detections2) > 0:
        boxes2 = detections2[0].boxes
        print(f'第二次分割（第{idx+1}个区域）检测到的目标数: {len(boxes2)}')
        for j, box2 in enumerate(boxes2.xyxy):
            x1, y1, x2, y2 = map(int, box2.cpu().numpy())
            sub_img = cut_img[y1:y2, x1:x2].copy()
            sub_path = os.path.join(OUTPUT_DIR, f'cut2_{idx+1}_{j+1}.png')
            cv2.imwrite(sub_path, cv2.cvtColor(sub_img, cv2.COLOR_RGB2BGR))
            print(f'已保存第{idx+1}个区域的第{j+1}个子图: {sub_path}')
    else:
        print(f'第二次分割（第{idx+1}个区域）未检测到任何目标')