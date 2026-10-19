import { Color, Graphics, Label, Node, UITransform } from 'cc';

// Canvas 的相机只渲染 UI_2D 层，代码里 new 出来的节点默认不在这一层，必须继承父节点的 layer 才看得见
export function createNode(name: string, parent: Node): Node {
    const n = new Node(name);
    n.layer = parent.layer;
    n.addComponent(UITransform);
    parent.addChild(n);
    return n;
}

export function createGraphics(name: string, parent: Node): Graphics {
    return createNode(name, parent).addComponent(Graphics);
}

export function createLabel(name: string, parent: Node, text: string, size: number, color: Color): Label {
    const label = createNode(name, parent).addComponent(Label);
    label.string = text;
    label.fontSize = size;
    label.lineHeight = size * 1.2;
    label.color = color;
    // 大量重复的小字共用一张字符图集，不必每个 Label 各生成一张贴图；
    // 大字号会把共享图集撑满，导致别的字显示不出来，所以大字单独渲染
    label.cacheMode = size >= 60 ? Label.CacheMode.NONE : Label.CacheMode.CHAR;
    return label;
}
