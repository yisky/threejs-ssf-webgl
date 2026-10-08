import {
	Camera,
	Color,
	MathUtils,
	Matrix4,
	Uniform,
	Vector2,
	Vector3,
	type ColorRepresentation,
	type WebGLRenderer,
	type WebGLRenderTarget,
} from 'three';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import simplexNoise3d from './simplexNoise3d.glsl?raw';
import screenSpaceFog from './screenSpaceFog.glsl?raw';

const fragmentShader = `${simplexNoise3d}\n${screenSpaceFog}`;

export interface SSFEffectParams {

	blendFunction?: BlendFunction;
	enabled?: boolean;
	fogColor?: ColorRepresentation;
	fogMaxOpacity?: number;
	fogDensity?: number;
	fogHeight?: number;
	fogHeightFalloff?: number;
	fogStartDistance?: number;
	noiseStrength?: number;
	noiseScale?: number;
	noiseSpeed?: Vector2;
	inscatteringLightDirection?: Vector3;
	directionalInscatteringColor?: ColorRepresentation;
	directionalInscatteringExponent?: number;
	directionalInscatteringStartDistance?: number;
	/** 散射亮度。默认 1。配合 ACES 时调高，不着色调映射时保持 1。 */
	inscatteringIntensity?: number;

}

/**
 * 屏幕空间雾。
 *
 * 挂在 postprocessing 的 EffectPass 上，声明需要深度。片元着色器入口是 mainImage，
 * 每像素用深度还原世界坐标，再按高度雾的解析积分混合颜色。
 *
 * enabled 写成 uniform uEnabled，而不是 Effect 自身的开关：关掉雾时 pass 仍在跑，只是原样输出画面。
 * 相机矩阵按引用保存，每帧只更新相机位置和噪声时间。不要在效果上定义 DEPTH_PACKING，
 * EffectPass 会给宏加上前缀，深度解包由 composer 按深度纹理自己设置。
 */
export class SSFEffect extends Effect {

	private camera: Camera | null = null;

	constructor({
		blendFunction = BlendFunction.NORMAL,
		enabled = true,
		fogColor = '#bccbda',
		fogMaxOpacity = 1.0,
		fogDensity = 0.02,
		fogHeight = 10.0,
		fogHeightFalloff = 0.25,
		fogStartDistance = 0.0,
		noiseStrength = 0.1,
		noiseScale = 0.01,
		noiseSpeed = new Vector2(0.01, 0.01),
		inscatteringLightDirection = new Vector3(0.0, -1.0, 0.0),
		directionalInscatteringColor = '#fff3da',
		directionalInscatteringExponent = 8.0,
		directionalInscatteringStartDistance = 0.0,
		inscatteringIntensity = 1.0,
	}: SSFEffectParams = {}) {

		super('SSFEffect', fragmentShader, {

			blendFunction,
			// DEPTH 让 EffectPass 向上游要一张深度纹理，mainImage 才能收到 depth。
			attributes: EffectAttribute.DEPTH,
			uniforms: new Map<string, Uniform>([

				[ 'uEnabled', new Uniform(enabled) ],
				[ 'uFogColor', new Uniform(new Color(fogColor)) ],
				[ 'uFogMaxOpacity', new Uniform(MathUtils.clamp(fogMaxOpacity, 0.0, 1.0)) ],
				[ 'uFogDensity', new Uniform(fogDensity) ],
				[ 'uFogHeight', new Uniform(fogHeight) ],
				[ 'uFogHeightFalloff', new Uniform(fogHeightFalloff) ],
				[ 'uFogStartDistance', new Uniform(fogStartDistance) ],
				[ 'uNoiseStrength', new Uniform(noiseStrength) ],
				[ 'uNoiseScale', new Uniform(noiseScale) ],
				[ 'uNoiseSpeed', new Uniform(noiseSpeed) ],
				[ 'uNoiseTime', new Uniform(0) ],
				[ 'uInscatteringLightDirection', new Uniform(new Vector3().copy(inscatteringLightDirection).normalize()) ],
				[ 'uDirectionalInscatteringColor', new Uniform(new Color(directionalInscatteringColor)) ],
				[ 'uDirectionalInscatteringExponent', new Uniform(directionalInscatteringExponent) ],
				[ 'uDirectionalInscatteringStartDistance', new Uniform(directionalInscatteringStartDistance) ],
				[ 'uInscatteringIntensity', new Uniform(inscatteringIntensity) ],
				[ 'uCameraPosition', new Uniform(new Vector3()) ],
				[ 'uCameraWorldMatrix', new Uniform(new Matrix4()) ],
				[ 'uCameraProjectionMatrix', new Uniform(new Matrix4()) ],
				[ 'uCameraProjectionMatrixInverse', new Uniform(new Matrix4()) ],

			]),

		});

	}

	/** 只改雾的开关。pass 继续执行，着色器在 uEnabled 为假时直接返回输入颜色。 */
	set enabled(value: boolean) {

		this.uniforms.get('uEnabled')!.value = value;

	}

	/** EffectComposer.setMainCamera 会调到这里。矩阵用引用，相机动了着色器里的矩阵跟着变。 */
	override set mainCamera(value: Camera) {

		this.camera = value;
		this.uniforms.get('uCameraWorldMatrix')!.value = value.matrixWorld;
		this.uniforms.get('uCameraProjectionMatrix')!.value = value.projectionMatrix;
		this.uniforms.get('uCameraProjectionMatrixInverse')!.value = value.projectionMatrixInverse;

	}

	set fogColor(value: ColorRepresentation) {

		this.uniforms.get('uFogColor')!.value.set(value);

	}

	set fogMaxOpacity(value: number) {

		this.uniforms.get('uFogMaxOpacity')!.value = MathUtils.clamp(value, 0.0, 1.0);

	}

	set fogDensity(value: number) {

		this.uniforms.get('uFogDensity')!.value = value;

	}

	set fogHeight(value: number) {

		this.uniforms.get('uFogHeight')!.value = value;

	}

	set fogHeightFalloff(value: number) {

		this.uniforms.get('uFogHeightFalloff')!.value = value;

	}

	set fogStartDistance(value: number) {

		this.uniforms.get('uFogStartDistance')!.value = value;

	}

	set noiseStrength(value: number) {

		this.uniforms.get('uNoiseStrength')!.value = value;

	}

	set noiseScale(value: number) {

		this.uniforms.get('uNoiseScale')!.value = value;

	}

	set noiseSpeed(value: Vector2) {

		this.uniforms.get('uNoiseSpeed')!.value.copy(value);

	}

	/** 方向是光的传播方向，头顶的太阳是 (0, -1, 0)。写入前归一化。 */
	set inscatteringLightDirection(value: Vector3) {

		this.uniforms.get('uInscatteringLightDirection')!.value.copy(value).normalize();

	}

	set directionalInscatteringColor(value: ColorRepresentation) {

		this.uniforms.get('uDirectionalInscatteringColor')!.value.set(value);

	}

	set directionalInscatteringExponent(value: number) {

		this.uniforms.get('uDirectionalInscatteringExponent')!.value = value;

	}

	set directionalInscatteringStartDistance(value: number) {

		this.uniforms.get('uDirectionalInscatteringStartDistance')!.value = value;

	}

	/** 散射亮度。不着色调映射时用 1；ACES 会压高光，需要调高才能看见光晕。 */
	set inscatteringIntensity(value: number) {

		this.uniforms.get('uInscatteringIntensity')!.value = value;

	}

	/**
	 * 每帧由 EffectPass 调用。相机还没设进来时不加时间，避免第一帧把噪声时间推飞。
	 * deltaTime 单位是秒，来自 composer.render。
	 */
	override update(_renderer: WebGLRenderer, _inputBuffer: WebGLRenderTarget, deltaTime?: number): void {

		const camera = this.camera;

		if (camera === null) {

			return;

		}

		this.uniforms.get('uNoiseTime')!.value += deltaTime ?? 0.0;
		this.uniforms.get('uCameraPosition')!.value.setFromMatrixPosition(camera.matrixWorld);

	}

}
