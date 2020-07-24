import { Fragment as div, FunctionComponent, h, JSX, createContext, Component } from 'preact';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import VirtualList from 'preact-virtual-list';
import '../styles.css';
import styles from './assembly.module.css';
import { classes } from '../util';
import { Scrollable } from "../scrollable";

import { IProfileModel } from '../model';
import { VsCodeApi } from '../vscodeApi';
import { IOpenDocumentMessage } from '../types';
import { useCssVariables } from '../useCssVariables';
declare const MODELS: IProfileModel[];

interface Location {
	file: string;
	line: number;
}

const integerFormat = new Intl.NumberFormat(undefined, {
	maximumFractionDigits: 0
});

interface Line {
	pc?: number;
	hits?: number;
	cycles?: number;
	text: string;
	loc?: Location;
}

export const AssemblyView: FunctionComponent<{
	frame: number,
	time: number
}> = ({ frame, time }) => {
	const content = useMemo(() => {
		const content: Line[] = [];
		const textSection = MODELS[0].amiga.sections.find((section) => section.name === '.text');
		const hits = new Array<number>(textSection.size >> 1).fill(0);
		const cycles = new Array<number>(textSection.size >> 1).fill(0);
		const pcTrace = MODELS[frame].amiga.pcTrace;
		for(let i = 0; i < pcTrace.length; i += 2) {
			if(pcTrace[i] >= 0 && pcTrace[i] < textSection.size) {
				hits[pcTrace[i] >> 1]++;
				cycles[pcTrace[i] >> 1] += pcTrace[i + 1];
			}
		}

		const lines = MODELS[0].amiga.objdump.replace(/\r/g, '').split('\n');
		let loc;
		for(const line of lines) {
			const locMatch = line.match(/^(\S.+):([0-9]+)( \(discriminator [0-9]+\))?$/);
			if(locMatch) {
				loc = { file: locMatch[1], line: parseInt(locMatch[2]) };
				continue;
			}

			const insnMatch = line.match(/^ *([0-9a-f]+):\t/);
			if(insnMatch) {
				const pc = parseInt(insnMatch[1], 16);
				content.push({
					pc,
					hits: hits[pc >> 1],
					cycles: cycles[pc >> 1],
					text: line,
					loc
				});
				loc = undefined;
			} else {
				content.push({ text: line });
			}
		}
		return content;
	}, [frame]);

	const pc = useMemo(() => {
		const pcTrace = MODELS[frame].amiga.pcTrace;
		let t = 0;
		let pc = 0;
		for(let i = 0; i < pcTrace.length; i += 2) {
			pc = pcTrace[i];
			t += pcTrace[i + 1];
			if(t > time)
				break;
		}
		return pc;
	}, [frame, time]);

	const onClick = useCallback((evt: MouseEvent) => {
		VsCodeApi.postMessage<IOpenDocumentMessage>({
			type: 'openDocument',
			location: {
				lineNumber: (evt.srcElement as HTMLElement).attributes['data-line'].value,
				columnNumber: 0,
				source: { path: (evt.srcElement as HTMLElement).attributes['data-file'].value }
			},
			toSide: true,
		});
	}, []);

	const cssVariables = useCssVariables();
	const height = parseInt(cssVariables['editor-font-size']) + 3; // needs to match CSS

	const renderRow = useCallback((c: Line) => (
		c.pc === undefined
		? <div class={styles.row}>{c.text + '\n'}</div>
		: <div class={[styles.row, c.cycles === 0 ? styles.zero : '', c.pc === pc ? styles.cur : ''].join(' ')}>
			<span class={styles.duration}>{integerFormat.format(c.cycles).padStart(8) + 'cy (' + integerFormat.format(c.hits).padStart(6) + ') '}</span>
			{c.text}
			{c.loc !== undefined ? <div class={styles.file}><a href='#' data-file={c.loc.file} data-line={c.loc.line} onClick={onClick}>{c.loc.file}:{c.loc.line}</a></div> : ''}
			{'\n'}
		</div>		
	), [onClick, pc]);

	const listRef = useRef<Component>();
	const scroller = useMemo(() => listRef.current && new Scrollable(listRef.current.base as HTMLElement, 135), [listRef.current]);
	useEffect(() => {
		const sel = content.findIndex((c: Line) => c.pc === pc);
		if(sel >= 0) {
			const containerHeight = (listRef.current.base as HTMLElement).clientHeight;
			const slack = containerHeight / 10;
			const scrollTo = sel * height;
			const newTop = scrollTo - containerHeight / 2;
			if(scrollTo < scroller.getFutureScrollPosition() + slack || scrollTo > scroller.getFutureScrollPosition() + containerHeight - slack)
				scroller?.setScrollPositionSmooth(newTop);
		}
	}, [pc, scroller]);

	return <VirtualList
		ref={listRef}
		className={styles.container}
		data={content}
		renderRow={renderRow}
		rowHeight={height}
		overscanCount={10}
	/>;
}