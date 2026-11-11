"""Audited adapters for official HRNet, HF Mask2Former and SAM architectures."""
import hashlib,json,os,weakref
from pathlib import Path
from types import SimpleNamespace
import torch
from torch import nn
from torch.nn import functional as F
W=Path(__file__).resolve().parents[2]/'model_assets';MODELS=('review_hrnet_w48','review_mask2former_swin_t','review_sam_vit_b_decoder')
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def pad32(x):return F.pad(x,(0,(-x.shape[-1])%32,0,(-x.shape[-2])%32))
class Attr(dict):
    __getattr__=dict.__getitem__
def attr(d):return Attr({k:attr(v) if isinstance(v,dict) else v for k,v in d.items()})
def report(path,model,extra):
    return dict(loaded=True,coverage=1.0,path=str(path),weight_path=str(path),weight_sha256=sha(path),**extra,
        total_parameters=sum(p.numel() for p in model.parameters()),trainable_parameters=sum(p.numel() for p in model.parameters() if p.requires_grad))

class HRNet(nn.Module):
    modern_kind='hrnet'
    def __init__(self):
        super().__init__();import yaml
        from .hrnet_official import HighResolutionNet
        cfg=attr(yaml.safe_load((Path(__file__).parent/'hrnet_config.yaml').read_text()));cfg.DATASET.NUM_CLASSES=2
        self.core=HighResolutionNet(cfg)
        self.method_report=dict(architecture='official HRNetV2-W48 semantic FCN head',pretraining='ImageNet timm hrnet_w48.ms_in1k',normalization='ImageNet',loss='per-image CE0.5 + Dice0.5')
    def forward(self,x):
        h,w=x.shape[-2:];z=self.core(pad32(x));z=F.interpolate(z,size=pad32(x).shape[-2:],mode='bilinear',align_corners=False)
        return z[:,:,:h,:w]
    def backbone_parameters(self):return [p for n,p in self.core.named_parameters() if not n.startswith('last_layer.')]

class NativeMaskLoss(nn.Module):
    def __init__(self,model):super().__init__();object.__setattr__(self,'ref',weakref.ref(model))
    def set_step(self,step):pass
    def forward(self,logits,target):
        model=self.ref();out=model._outputs;assert out is not None
        masks=[];classes=[]
        for y in target:
            labels=torch.unique(y);labels=labels[labels!=255]
            classes.append(labels.long());masks.append(torch.stack([(y==c).float() for c in labels]))
        losses=model.core.get_loss_dict(out.masks_queries_logits,out.class_queries_logits,masks,classes,out.auxiliary_logits)
        loss=model.core.get_loss(losses);model._outputs=None;return loss

class Mask2Former(nn.Module):
    modern_kind='mask2former'
    def __init__(self):
        super().__init__()
        from transformers import Mask2FormerConfig,Mask2FormerForUniversalSegmentation
        cfg=Mask2FormerConfig.from_pretrained(str(W/'mask2former'),local_files_only=True)
        cfg.id2label={0:'background',1:'PPD'};cfg.label2id={'background':0,'PPD':1};cfg.num_labels=2;cfg.output_auxiliary_logits=True
        self.core=Mask2FormerForUniversalSegmentation(cfg);self._outputs=None
        self.method_report=dict(architecture='HF4.38 Mask2Former Swin-T',pretraining='facebook/mask2former-swin-tiny-ade-semantic, ADE20K',
            classification_head='2 classes plus no-object, random reinitialization',loss='native Hungarian matching + class2/mask5/dice5 and auxiliary decoder losses',prompts='none',custom_cuda_extensions=False)
    def forward(self,x):
        h,w=x.shape[-2:];p=pad32(x);out=self.core(pixel_values=p,output_auxiliary_logits=self.training,return_dict=True)
        if self.training:self._outputs=out
        def semantic():
            masks=F.interpolate(out.masks_queries_logits,size=p.shape[-2:],mode='bilinear',align_corners=False).sigmoid()
            probs=out.class_queries_logits.softmax(-1)[...,:-1]
            scores=torch.einsum('bqc,bqhw->bchw',probs,masks).clamp_min(1e-8)
            scores=scores/scores.sum(1,keepdim=True)
            return scores.log()[:,:,:h,:w]
        if self.training:
            with torch.no_grad():return semantic()
        return semantic()
    def native_criterion(self):return NativeMaskLoss(self)
    def loss_metadata(self):return dict(loss_implementation='Mask2Former_native_Hungarian_class2_mask5_dice5_aux_HF4.38',cldice_weight=0.)
    def backbone_parameters(self):return list(self.core.model.pixel_level_module.encoder.parameters())

class SAM(nn.Module):
    modern_kind='sam'
    def __init__(self):
        super().__init__()
        from transformers import SamConfig,SamModel
        cfg=SamConfig.from_pretrained(str(W/'sam'),local_files_only=True);self.core=SamModel(cfg)
        for p in self.core.vision_encoder.parameters():p.requires_grad_(False)
        for p in self.core.prompt_encoder.parameters():p.requires_grad_(False)
        if hasattr(self.core,'shared_image_embedding'):
            for p in self.core.shared_image_embedding.parameters():p.requires_grad_(False)
        self.method_report=dict(architecture='SAM ViT-B',pretraining='facebook/sam-vit-base, SA-1B',finetuning='original mask decoder only; image and prompt encoders frozen',
            prompts='fixed null prompt, no clicks/boxes and no ground-truth-derived prompts during training or validation',input='long side 1024 with right/bottom padding; restore logits to original pixel grid',loss='per-image CE0.5+Dice0.5')
    def train(self,mode=True):
        super().train(mode);self.core.vision_encoder.eval();self.core.prompt_encoder.eval();return self
    def forward(self,x):
        h,w=x.shape[-2:];scale=1024/max(h,w);nh,nw=round(h*scale),round(w*scale)
        p=F.interpolate(x,size=(nh,nw),mode='bilinear',align_corners=False);p=F.pad(p,(0,1024-nw,0,1024-nh))
        with torch.no_grad():emb=self.core.get_image_embeddings(p)
        out=self.core(image_embeddings=emb,multimask_output=False,return_dict=True)
        z=out.pred_masks[:,0,0].unsqueeze(1);z=F.interpolate(z,size=(1024,1024),mode='bilinear',align_corners=False)[:,:,:nh,:nw]
        z=F.interpolate(z,size=(h,w),mode='bilinear',align_corners=False);return torch.cat([torch.zeros_like(z),z],dim=1)
    def backbone_parameters(self):return []

def build_with_pretrained(name):
    cls={'review_hrnet_w48':HRNet,'review_mask2former_swin_t':Mask2Former,'review_sam_vit_b_decoder':SAM}[name]
    model=cls();folder={'hrnet':'hrnet','mask2former':'mask2former','sam':'sam'}[model.modern_kind];path=W/folder/'pytorch_model.bin'
    state=torch.load(path,map_location='cpu',weights_only=True);state=state.get('state_dict',state);own=model.core.state_dict()
    compatible={k:v for k,v in state.items() if k in own and own[k].shape==v.shape}
    expected=set(own)
    if folder=='hrnet':expected={k for k in own if not k.startswith('last_layer.')}
    if folder=='mask2former':expected={k for k in own if not k.startswith(('class_predictor.','criterion.empty_weight'))}
    missing=sorted(expected-set(compatible));assert not missing,(name,missing[:20])
    model.core.load_state_dict(compatible,strict=False)
    return model,report(path,model,dict(matched_tensors=len(expected),total_backbone_tensors=len(expected),new_head_tensors=sorted(set(own)-expected),source_unused_tensors=len(set(state)-set(compatible)),method=model.method_report))

def param_groups(model,lr,backbone_lr_mult=.1,layer_decay=1.):
    bb=[p for p in model.backbone_parameters() if p.requires_grad];ids={id(p) for p in bb}
    head=[p for p in model.parameters() if p.requires_grad and id(p) not in ids]
    groups=([{'params':bb,'lr':lr*backbone_lr_mult}] if bb else [])+[{'params':head,'lr':lr}]
    assert len({id(p) for g in groups for p in g['params']})==sum(p.requires_grad for p in model.parameters())
    return groups
