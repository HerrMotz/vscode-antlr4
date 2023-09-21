/*
 * Copyright (c) Mike Lischke. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 */
import {
    TextDocument, CancellationToken, Range, Location, Uri, SymbolInformation, DocumentSymbolProvider, ProviderResult,
} from "vscode";

import { AntlrFacade } from "../backend/facade.js";
import { SymbolKind } from "../backend/types.js";
import { symbolDescriptionFromEnum, translateSymbolKind } from "./Symbol.js";

export class AntlrSymbolProvider implements DocumentSymbolProvider {
    public constructor(private backend: AntlrFacade) { }

    public provideDocumentSymbols(document: TextDocument,
        _cancel: CancellationToken): ProviderResult<SymbolInformation[]> {

        return new Promise((resolve) => {
            const symbols = this.backend.listTopLevelSymbols(document.fileName, false);
            const symbolsList = [];
            for (const symbol of symbols) {
                if (!symbol.definition) {
                    continue;
                }

                const startRow = symbol.definition.range.start.row > 0 ? symbol.definition.range.start.row - 1 : 0;
                const endRow = symbol.definition.range.end.row > 0 ? symbol.definition.range.end.row - 1 : 0;
                const range = new Range(startRow, symbol.definition.range.start.column, endRow,
                    symbol.definition.range.end.column);
                const location = new Location(Uri.file(symbol.source), range);

                let description = symbolDescriptionFromEnum(symbol.kind);
                const kind = translateSymbolKind(symbol.kind);
                const totalTextLength = symbol.name.length + description.length + 1;
                if (symbol.kind === SymbolKind.LexerMode && totalTextLength < 80) {
                    // Add a marker to show parts which belong to a particular lexer mode.
                    // Not 100% perfect (i.e. right aligned, as symbol and description use different fonts),
                    // but good enough.
                    const markerWidth = 80 - totalTextLength;
                    description += " " + "-".repeat(markerWidth);
                }
                const info = new SymbolInformation(symbol.name, kind, description, location);
                symbolsList.push(info);
            }

            resolve(symbolsList);
        });
    }
}
