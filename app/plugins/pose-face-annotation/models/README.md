# Detection models

These models and inference helpers are distributed by the
[OpenCV Model Zoo](https://github.com/opencv/opencv_zoo):

- `face_detection_yunet_2023mar.onnx`: YuNet face detector, MIT license.
- `person_detection_mediapipe_2023mar.onnx` and `mp_persondet.py`: BlazePose person detector, Apache-2.0 license.
- `pose_estimation_mediapipe_2023mar.onnx` and `mp_pose.py`: BlazePose pose estimator, Apache-2.0 license.

The plugin uses OpenCV DNN directly. No Torch or MediaPipe Python package is required.