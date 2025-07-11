/*
* Licensed to the Apache Software Foundation (ASF) under one
* or more contributor license agreements.  See the NOTICE file
* distributed with this work for additional information
* regarding copyright ownership.  The ASF licenses this file
* to you under the Apache License, Version 2.0 (the
* "License"); you may not use this file except in compliance
* with the License.  You may obtain a copy of the License at
*
*   http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing,
* software distributed under the License is distributed on an
* "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
* KIND, either express or implied.  See the License for the
* specific language governing permissions and limitations
* under the License.
*/

import * as graphic from '../../util/graphic';
import {getECData} from '../../util/innerStore';
import * as layout from '../../util/layout';
import {wrapTreePathInfo} from '../helper/treeHelper';
import TreemapSeriesModel, { TreemapSeriesNodeItemOption, TreemapSeriesOption } from './TreemapSeries';
import ExtensionAPI from '../../core/ExtensionAPI';
import { TreeNode } from '../../data/Tree';
import { curry, defaults } from 'zrender/src/core/util';
import { ZRElementEvent, ECElement } from '../../util/types';
import Element from 'zrender/src/Element';
import Model from '../../model/Model';
import { convertOptionIdName } from '../../util/model';
import { toggleHoverEmphasis, Z2_EMPHASIS_LIFT } from '../../util/states';
import { createTextStyle } from '../../label/labelStyle';

const TEXT_PADDING = 8;
const ITEM_GAP = 8;
const ARRAY_LENGTH = 5;

interface OnSelectCallback {
    (node: TreeNode, e: ZRElementEvent): void
}

interface LayoutParam {
    emptyItemWidth: number
    totalWidth: number
    renderList: {
        node: TreeNode,
        text: string
        width: number
    }[]
}

type BreadcrumbItemStyleModel = Model<TreemapSeriesOption['breadcrumb']['itemStyle']>;
type BreadcrumbEmphasisItemStyleModel = Model<TreemapSeriesOption['breadcrumb']['emphasis']>;
type BreadcrumbTextStyleModel = Model<TreemapSeriesOption['breadcrumb']['itemStyle']['textStyle']>;

class Breadcrumb {

    group = new graphic.Group();

    constructor(containerGroup: graphic.Group) {
        containerGroup.add(this.group);
    }

    render(
        seriesModel: TreemapSeriesModel,
        api: ExtensionAPI,
        targetNode: TreeNode,
        onSelect: OnSelectCallback
    ) {
        const model = seriesModel.getModel('breadcrumb');
        const thisGroup = this.group;

        thisGroup.removeAll();

        if (!model.get('show') || !targetNode) {
            return;
        }

        const normalStyleModel = model.getModel('itemStyle');
        const emphasisModel = model.getModel('emphasis');
        const textStyleModel = normalStyleModel.getModel('textStyle');
        const emphasisTextStyleModel = emphasisModel.getModel(['itemStyle', 'textStyle']);

        const refContainer = layout.createBoxLayoutReference(seriesModel, api).refContainer;
        const boxLayoutParams = {
            left: model.get('left'),
            right: model.get('right'),
            top: model.get('top'),
            bottom: model.get('bottom')
        };
        const layoutParam: LayoutParam = {
            emptyItemWidth: model.get('emptyItemWidth'),
            totalWidth: 0,
            renderList: []
        };
        const availableSize = layout.getLayoutRect(
            boxLayoutParams,
            refContainer,
        );
        this._prepare(targetNode, layoutParam, textStyleModel);
        this._renderContent(
            seriesModel, layoutParam, availableSize, normalStyleModel,
            emphasisModel, textStyleModel, emphasisTextStyleModel, onSelect
        );

        layout.positionElement(thisGroup, boxLayoutParams, refContainer);
    }

    /**
     * Prepare render list and total width
     * @private
     */
    _prepare(targetNode: TreeNode, layoutParam: LayoutParam, textStyleModel: BreadcrumbTextStyleModel) {
        for (let node = targetNode; node; node = node.parentNode) {
            const text = convertOptionIdName(node.getModel<TreemapSeriesNodeItemOption>().get('name'), '');
            const textRect = textStyleModel.getTextRect(text);
            const itemWidth = Math.max(
                textRect.width + TEXT_PADDING * 2,
                layoutParam.emptyItemWidth
            );
            layoutParam.totalWidth += itemWidth + ITEM_GAP;
            layoutParam.renderList.push({
                node: node,
                text: text,
                width: itemWidth
            });
        }
    }

    /**
     * @private
     */
    _renderContent(
        seriesModel: TreemapSeriesModel,
        layoutParam: LayoutParam,
        availableSize: {width: number, height: number},
        normalStyleModel: BreadcrumbItemStyleModel,
        emphasisModel: BreadcrumbEmphasisItemStyleModel,
        textStyleModel: BreadcrumbTextStyleModel,
        emphasisTextStyleModel: BreadcrumbTextStyleModel,
        onSelect: OnSelectCallback
    ) {
        // Start rendering.
        let lastX = 0;
        const emptyItemWidth = layoutParam.emptyItemWidth;
        const height = seriesModel.get(['breadcrumb', 'height']);
        let totalWidth = layoutParam.totalWidth;
        const renderList = layoutParam.renderList;
        const emphasisItemStyle = emphasisModel.getModel('itemStyle').getItemStyle();

        for (let i = renderList.length - 1; i >= 0; i--) {
            const item = renderList[i];
            const itemNode = item.node;
            let itemWidth = item.width;
            let text = item.text;

            // Hdie text and shorten width if necessary.
            if (totalWidth > availableSize.width) {
                totalWidth -= itemWidth - emptyItemWidth;
                itemWidth = emptyItemWidth;
                text = null;
            }

            const el = new graphic.Polygon({
                shape: {
                    points: makeItemPoints(
                        lastX, 0, itemWidth, height,
                        i === renderList.length - 1, i === 0
                    )
                },
                style: defaults(
                    normalStyleModel.getItemStyle(),
                    {
                        lineJoin: 'bevel'
                    }
                ),
                textContent: new graphic.Text({
                    style: createTextStyle(textStyleModel, { text })
                }),
                textConfig: {
                    position: 'inside'
                },
                z2: Z2_EMPHASIS_LIFT * 1e4,    // A very large z2
                onclick: curry(onSelect, itemNode)
            });
            (el as ECElement).disableLabelAnimation = true;
            el.getTextContent().ensureState('emphasis').style = createTextStyle(emphasisTextStyleModel, { text });
            el.ensureState('emphasis').style = emphasisItemStyle;
            toggleHoverEmphasis(
                el, emphasisModel.get('focus'), emphasisModel.get('blurScope'), emphasisModel.get('disabled')
            );
            this.group.add(el);

            packEventData(el, seriesModel, itemNode);

            lastX += itemWidth + ITEM_GAP;
        }
    }

    remove() {
        this.group.removeAll();
    }
}

function makeItemPoints(x: number, y: number, itemWidth: number, itemHeight: number, head: boolean, tail: boolean) {
    const points = [
        [head ? x : x - ARRAY_LENGTH, y],
        [x + itemWidth, y],
        [x + itemWidth, y + itemHeight],
        [head ? x : x - ARRAY_LENGTH, y + itemHeight]
    ];
    !tail && points.splice(2, 0, [x + itemWidth + ARRAY_LENGTH, y + itemHeight / 2]);
    !head && points.push([x, y + itemHeight / 2]);
    return points;
}

// Package custom mouse event.
function packEventData(el: Element, seriesModel: TreemapSeriesModel, itemNode: TreeNode) {
    getECData(el).eventData = {
        componentType: 'series',
        componentSubType: 'treemap',
        componentIndex: seriesModel.componentIndex,
        seriesIndex: seriesModel.seriesIndex,
        seriesName: seriesModel.name,
        seriesType: 'treemap',
        selfType: 'breadcrumb', // Distinguish with click event on treemap node.
        nodeData: {
            dataIndex: itemNode && itemNode.dataIndex,
            name: itemNode && itemNode.name
        },
        treePathInfo: itemNode && wrapTreePathInfo(itemNode, seriesModel)
    };
}

export default Breadcrumb;