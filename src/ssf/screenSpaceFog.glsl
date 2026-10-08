// 屏幕空间高度雾。
// 密度 ρ(y) = fogDensity * exp2(-fogHeightFalloff * (y - fogHeight))，低处浓、高处淡。
// 噪声加在雾面高度上，不乘密度。透射率 T = exp2(-光学深度)，并且不低于 1 - fogMaxOpacity。
// 输出 = 雾色 * (1 - T) + 方向散射 * 强度 + 场景色 * T。
// 强度默认 1。开了 ACES 时由调用方调高，用来抵消肩部压缩；不着色调映射时保持 1，避免光晕被截成白块。
// getViewZ、readDepth、saturate、cameraNear/Far 来自 EffectPass 的前导代码，这里不要再定义。

const float FLT_EPSILON = 0.001;
const float FLT_EPSILON2 = 0.01;
const float LN2 = 0.69314718056;

uniform bool uEnabled;

uniform vec3 uFogColor;
uniform float uFogMaxOpacity;

uniform float uFogDensity;
uniform float uFogHeight;
uniform float uFogHeightFalloff;
uniform float uFogStartDistance;

uniform float uNoiseStrength;
uniform float uNoiseScale;
uniform float uNoiseTime;
uniform vec2 uNoiseSpeed;

uniform vec3 uInscatteringLightDirection;
uniform vec3 uDirectionalInscatteringColor;
uniform float uDirectionalInscatteringExponent;
uniform float uDirectionalInscatteringStartDistance;
uniform float uInscatteringIntensity;

uniform vec3 uCameraPosition;
uniform mat4 uCameraWorldMatrix;
uniform mat4 uCameraProjectionMatrix;
uniform mat4 uCameraProjectionMatrixInverse;

// 用窗口深度和 viewZ 还原世界坐标。screenPosition、depth 都是 0 到 1。
// clipW 把 NDC 变回裁剪空间，再乘投影逆矩阵和相机世界矩阵。
vec3 getWorldPosition(const in vec2 screenPosition, const in float depth, const in float viewZ) {

	float clipW = uCameraProjectionMatrix[2][3] * viewZ + uCameraProjectionMatrix[3][3];

	vec4 clipSpacePosition = vec4((vec3(screenPosition, depth) - 0.5) * 2.0, 1.0);
	clipSpacePosition *= clipW;

	vec4 viewSpacePosition = uCameraProjectionMatrixInverse * clipSpacePosition;

	return (uCameraWorldMatrix * viewSpacePosition).xyz;

}

// 密度 ρ(y) = uFogDensity * exp2(-uFogHeightFalloff * (y - fogHeight))
// 沿长度为 rayLength、高度从 y0 到 y1 的射线做解析积分。以较密一端为基准，避免绝对高程把 exp2 打爆。
float getOpticalDepth(const in float y0, const in float y1, const in float rayLength, const in float fogHeight) {

	if (rayLength <= 0.0) {

		return 0.0;

	}

	float e0 = -uFogHeightFalloff * (y0 - fogHeight);
	float e1 = -uFogHeightFalloff * (y1 - fogHeight);
	float x = abs(e0 - e1);

	float lineIntegral = x < FLT_EPSILON2 ? 1.0 : (1.0 - exp2(-x)) / (x * LN2);

	return uFogDensity * rayLength * exp2(min(max(e0, e1), 126.0)) * lineIntegral;

}

vec3 applyFog(const in vec3 col, const in vec3 worldPosition) {

	vec3 cameraToReceiver = worldPosition - uCameraPosition;
	float cameraToReceiverLengthSqrt = dot(cameraToReceiver, cameraToReceiver);

	if (cameraToReceiverLengthSqrt < FLT_EPSILON * FLT_EPSILON) {

		return col;

	}

	float cameraToReceiverLengthInv = inversesqrt(cameraToReceiverLengthSqrt);
	float cameraToReceiverLength = cameraToReceiverLengthSqrt * cameraToReceiverLengthInv;
	vec3 cameraToReceiverNormalized = cameraToReceiver * cameraToReceiverLengthInv;

	// 天空没有表面，命中点在远裁剪面上，相邻像素的世界坐标隔得太远，噪声会变成细斑。
	// 改到射线与雾面的交点采样，并限制距离，让斑块留在屏幕上的尺度。
	vec3 noisePosition = worldPosition;
	float farDistance = -getViewZ(1.0);
	if (cameraToReceiverLength > farDistance * 0.95) {

		float t = 0.0;
		if (abs(cameraToReceiverNormalized.y) > 1e-3) {

			t = (uFogHeight - uCameraPosition.y) / cameraToReceiverNormalized.y;

		}
		t = clamp(t, 0.0, 2.0 / max(uNoiseScale, 1e-4));
		noisePosition = uCameraPosition + cameraToReceiverNormalized * t;

	}

	vec3 noiseSamplePosition = noisePosition * uNoiseScale;
	noiseSamplePosition.x += uNoiseTime * uNoiseSpeed.x;
	noiseSamplePosition.z += uNoiseTime * uNoiseSpeed.y;

	float noise = simplex_noise_3d(noiseSamplePosition);
	float heightOffset = noise * uNoiseStrength;
	float noisyFogHeight = uFogHeight + heightOffset;

	float fogExcludedLength = clamp(uFogStartDistance, 0.0, cameraToReceiverLength);
	float dirExcludedLength = clamp(uDirectionalInscatteringStartDistance, 0.0, cameraToReceiverLength);

	float fogStartY = uCameraPosition.y + cameraToReceiverNormalized.y * fogExcludedLength;
	float dirStartY = uCameraPosition.y + cameraToReceiverNormalized.y * dirExcludedLength;

	float exponentialHeightLineIntegral = getOpticalDepth(fogStartY, worldPosition.y, cameraToReceiverLength - fogExcludedLength, noisyFogHeight);
	float dirExponentialHeightLineIntegral = getOpticalDepth(dirStartY, worldPosition.y, cameraToReceiverLength - dirExcludedLength, noisyFogHeight);

	// 朝向光源时 -viewDir 与光的传播方向同向，pow 后的散射最强。
	vec3 directionalLightInscattering = uDirectionalInscatteringColor * uInscatteringIntensity * pow(saturate(dot(-cameraToReceiverNormalized, uInscatteringLightDirection)), uDirectionalInscatteringExponent);
	float directionalInscatteringFogFactor = saturate(exp2(-dirExponentialHeightLineIntegral));
	vec3 directionalInscattering = directionalLightInscattering * (1.0 - directionalInscatteringFogFactor);

	// 透射率有下限，雾再浓也保留 1 - fogMaxOpacity 的场景色。
	float expFogFactor = max(saturate(exp2(-exponentialHeightLineIntegral)), 1.0 - uFogMaxOpacity);

	return uFogColor * (1.0 - expFogFactor) + directionalInscattering + col * expFogFactor;

}

// uv、depth 由 EffectPass 传入。depth 为 1 是远裁剪面，也就是没有几何体的天空。
void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {

	if (uEnabled) {

		float viewZ = getViewZ(depth);
		vec3 worldPosition = getWorldPosition(uv, depth, viewZ);

		outputColor.rgb = applyFog(inputColor.rgb, worldPosition);
		outputColor.a = inputColor.a;

	} else {

		outputColor = inputColor;

	}

}
