/*
 * Copyright (c) Mike Lischke. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 */

import { BaseSymbol, ISymbolTableOptions, ScopedSymbol, SymbolConstructor, SymbolTable } from "antlr4-c3";
import { ParseTree, ParserRuleContext } from "antlr4ng";

import { CodeActionType, ISymbolInfo, SymbolGroupKind, SymbolKind } from "../types.js";
import { BuiltInChannelSymbol } from "./parser-symbols/BuiltInChannelSymbol.js";
import { BuiltInModeSymbol } from "./parser-symbols/BuiltInModeSymbol.js";
import { BuiltInTokenSymbol } from "./parser-symbols/BuiltInTokenSymbol.js";
import { FragmentTokenSymbol } from "./parser-symbols/FragmentTokenSymbol.js";
import { GlobalNamedActionSymbol } from "./parser-symbols/GlobalNamedActionSymbol.js";
import { definitionForContext, getKindFromSymbol, type ISourceContext } from "./helpers.js";
import { ImportSymbol } from "./parser-symbols/ImportSymbol.js";
import { LexerModeSymbol } from "./parser-symbols/LexerModeSymbol.js";
import { LexerPredicateSymbol } from "./parser-symbols/LexerPredicateSymbol.js";
import { LocalNamedActionSymbol } from "./parser-symbols/LocalNamedActionSymbol.js";
import { RuleSymbol } from "./parser-symbols/RuleSymbol.js";
import { TokenChannelSymbol } from "./parser-symbols/TokenChannelSymbol.js";
import { TokenSymbol } from "./parser-symbols/TokenSymbol.js";
import { VirtualTokenSymbol } from "./parser-symbols/VirtualTokenSymbol.js";

export class ContextSymbolTable extends SymbolTable {
    public tree: ParserRuleContext; // Set by the owning source context after each parse run.

    private symbolReferences = new Map<string, number>();

    // Caches with reverse lookup for indexed symbols.
    private namedActions: BaseSymbol[] = [];
    private parserActions: BaseSymbol[] = [];
    private lexerActions: BaseSymbol[] = [];
    private parserPredicates: BaseSymbol[] = [];
    private lexerPredicates: BaseSymbol[] = [];

    public constructor(name: string, options: ISymbolTableOptions, public owner?: ISourceContext) {
        super(name, options);
    }

    public override clear(): void {
        // Before clearing the dependencies make sure the owners are updated.
        if (this.owner) {
            for (const dep of this.dependencies) {
                if (dep instanceof ContextSymbolTable && dep.owner) {
                    this.owner.removeDependency(dep.owner);
                }
            }
        }

        this.symbolReferences.clear();
        this.namedActions = [];
        this.parserActions = [];
        this.lexerActions = [];
        this.parserPredicates = [];
        this.lexerPredicates = [];

        super.clear();
    }

    public symbolExists(name: string, kind: SymbolKind, localOnly: boolean): boolean {
        return this.getSymbolOfType(name, kind, localOnly) !== undefined;
    }

    public symbolExistsInGroup(symbol: string, kind: SymbolGroupKind, localOnly: boolean): boolean {
        // Group of lookups.
        switch (kind) {
            case SymbolGroupKind.TokenRef: {
                if (this.symbolExists(symbol, SymbolKind.BuiltInLexerToken, localOnly)) {
                    return true;
                }
                if (this.symbolExists(symbol, SymbolKind.VirtualLexerToken, localOnly)) {
                    return true;
                }
                if (this.symbolExists(symbol, SymbolKind.FragmentLexerToken, localOnly)) {
                    return true;
                }
                if (this.symbolExists(symbol, SymbolKind.LexerRule, localOnly)) {
                    return true;
                }
                break;
            }

            case SymbolGroupKind.LexerMode: {
                if (this.symbolExists(symbol, SymbolKind.BuiltInMode, localOnly)) {
                    return true;
                }
                if (this.symbolExists(symbol, SymbolKind.LexerMode, localOnly)) {
                    return true;
                }
                break;
            }

            case SymbolGroupKind.TokenChannel: {
                if (this.symbolExists(symbol, SymbolKind.BuiltInChannel, localOnly)) {
                    return true;
                }
                if (this.symbolExists(symbol, SymbolKind.TokenChannel, localOnly)) {
                    return true;
                }
                break;
            }

            case SymbolGroupKind.RuleRef: {
                if (this.symbolExists(symbol, SymbolKind.ParserRule, localOnly)) {
                    return true;
                }
                break;
            }

            default: {
                break;
            }
        }

        return false;
    }

    public contextForSymbol(symbolName: string, kind: SymbolKind, localOnly: boolean): ParseTree | undefined {
        const symbol = this.getSymbolOfType(symbolName, kind, localOnly);
        if (!symbol) {
            return undefined;
        }

        return symbol.context;
    }

    public getSymbolInfo(symbol: string | BaseSymbol): ISymbolInfo | undefined {
        if (!(symbol instanceof BaseSymbol)) {
            const temp = this.resolveSync(symbol);
            if (!temp) {
                return undefined;
            }
            symbol = temp;
        }

        let kind = getKindFromSymbol(symbol);
        const name = symbol.name;

        // Special handling for certain symbols.
        switch (kind) {
            case SymbolKind.TokenVocab:
            case SymbolKind.Import: {
                // Get the source id from a dependent module.
                this.dependencies.forEach((table: ContextSymbolTable) => {
                    if (table.owner && table.owner.sourceId.includes(name)) {
                        return { // TODO: implement a best match search.
                            kind,
                            name,
                            source: table.owner.fileName,
                            definition: definitionForContext(table.tree, true),
                        };
                    }
                });

                break;
            }

            case SymbolKind.Terminal: {
                // These are references to a depending grammar.
                this.dependencies.forEach((table: ContextSymbolTable) => {
                    const actualSymbol = table.resolveSync(name);
                    if (actualSymbol) {
                        symbol = actualSymbol;
                        kind = getKindFromSymbol(actualSymbol);
                    }
                });

                break;
            }

            default: {
                break;
            }
        }

        const symbolTable = symbol.symbolTable as ContextSymbolTable;

        return {
            kind,
            name,
            source: (symbol.context && symbolTable && symbolTable.owner) ? symbolTable.owner.fileName : "ANTLR runtime",
            definition: definitionForContext(symbol.context, true),
            description: undefined,
        };

    }

    public listTopLevelSymbols(localOnly: boolean): ISymbolInfo[] {
        const result: ISymbolInfo[] = [];

        const options = this.resolveSync("options", true);
        if (options) {
            const tokenVocab = options.resolveSync("tokenVocab", true);
            if (tokenVocab) {
                const value = this.getSymbolInfo(tokenVocab);
                if (value) {
                    result.push(value);
                }
            }
        }

        let symbols = this.symbolsOfType(ImportSymbol, localOnly);
        result.push(...symbols);
        symbols = this.symbolsOfType(BuiltInTokenSymbol, localOnly);
        result.push(...symbols);
        symbols = this.symbolsOfType(VirtualTokenSymbol, localOnly);
        result.push(...symbols);
        symbols = this.symbolsOfType(FragmentTokenSymbol, localOnly);
        result.push(...symbols);
        symbols = this.symbolsOfType(TokenSymbol, localOnly);
        result.push(...symbols);
        symbols = this.symbolsOfType(BuiltInModeSymbol, localOnly);
        result.push(...symbols);
        symbols = this.symbolsOfType(LexerModeSymbol, localOnly);
        result.push(...symbols);
        symbols = this.symbolsOfType(BuiltInChannelSymbol, localOnly);
        result.push(...symbols);
        symbols = this.symbolsOfType(TokenChannelSymbol, localOnly);
        result.push(...symbols);
        symbols = this.symbolsOfType(RuleSymbol, localOnly);
        result.push(...symbols);

        return result;
    }

    /**
     * Collects a list of action symbols.
     *
     * @param type The type of actions to return.
     *
     * @returns BaseSymbol information for each defined action.
     */
    public listActions(type: CodeActionType): ISymbolInfo[] {
        const result: ISymbolInfo[] = [];

        try {
            const list = this.actionListOfType(type);
            for (const entry of list) {
                const definition = definitionForContext(entry.context, true);
                if (definition && entry.name.toLowerCase() === "skip") {
                    // Seems there's a bug for the skip action where the parse tree indicates a
                    // single letter source range.
                    definition.range.end.column = definition.range.start.column + 3;
                }

                result.push({
                    kind: getKindFromSymbol(entry),
                    name: entry.name,
                    source: this.owner ? this.owner.fileName : "",
                    definition,
                    description: entry.context!.getText(),
                });
            }
        } catch {
            result.push({
                kind: SymbolKind.Unknown,
                name: "Error getting actions list",
                description: "Internal error occurred while collecting the list of defined actions",
                source: "",
            });
        }

        return result;
    }

    public getActionCounts(): Map<CodeActionType, number> {
        const result = new Map<CodeActionType, number>();

        let list = this.namedActions.filter((symbol) => {
            return symbol instanceof LocalNamedActionSymbol;
        });
        result.set(CodeActionType.LocalNamed, list.length);

        list = this.namedActions.filter((symbol) => {
            return symbol instanceof GlobalNamedActionSymbol;
        });
        result.set(CodeActionType.GlobalNamed, list.length);

        result.set(CodeActionType.ParserAction, this.parserActions.length);
        result.set(CodeActionType.LexerAction, this.lexerActions.length);
        result.set(CodeActionType.ParserPredicate, this.parserPredicates.length);
        result.set(CodeActionType.LexerPredicate, this.lexerPredicates.length);

        return result;
    }

    public getReferenceCount(symbolName: string): number {
        const reference = this.symbolReferences.get(symbolName);
        if (reference) {
            return reference;
        } else {
            return 0;
        }
    }

    public getUnreferencedSymbols(): string[] {
        const result: string[] = [];
        for (const entry of this.symbolReferences) {
            if (entry[1] === 0) {
                result.push(entry[0]);
            }
        }

        return result;
    }

    public incrementSymbolRefCount(symbolName: string): void {
        const reference = this.symbolReferences.get(symbolName);
        if (reference) {
            this.symbolReferences.set(symbolName, reference + 1);
        } else {
            this.symbolReferences.set(symbolName, 1);
        }
    }

    public getSymbolOccurrences(symbolName: string, localOnly: boolean): ISymbolInfo[] {
        const result: ISymbolInfo[] = [];

        const symbols = this.getAllSymbolsSync(BaseSymbol, localOnly);
        for (const symbol of symbols) {
            const owner = (symbol.root as ContextSymbolTable).owner;

            if (owner) {
                if (symbol.context && symbol.name === symbolName) {
                    let context = symbol.context;
                    if (symbol instanceof FragmentTokenSymbol) {
                        context = (symbol.context as ParserRuleContext).children[1];
                    } else if (symbol instanceof TokenSymbol || symbol instanceof RuleSymbol) {
                        context = (symbol.context as ParserRuleContext).children[0];
                    }

                    result.push({
                        kind: getKindFromSymbol(symbol),
                        name: symbolName,
                        source: owner.fileName,
                        definition: definitionForContext(context, true),
                        description: undefined,
                    });
                }

                if (symbol instanceof ScopedSymbol) {
                    const references = symbol.getAllNestedSymbolsSync(symbolName);
                    for (const reference of references) {
                        result.push({
                            kind: getKindFromSymbol(reference),
                            name: symbolName,
                            source: owner.fileName,
                            definition: definitionForContext(reference.context, true),
                            description: undefined,
                        });
                    }
                }
            }
        }

        return result;
    }

    /**
     * Stores the given symbol in the named action cache.
     *
     * @param action The symbol representing the action.
     */
    public defineNamedAction(action: BaseSymbol): void {
        this.namedActions.push(action);
    }

    /**
     * Stores the given action in the parser action cache.
     *
     * @param action The symbol representing the action.
     */
    public defineParserAction(action: BaseSymbol): void {
        this.parserActions.push(action);
    }

    /**
     * Stores the given symbol in the lexer action cache.
     *
     * @param action The symbol representing the action.
     */
    public defineLexerAction(action: BaseSymbol): void {
        this.lexerActions.push(action);
    }

    /**
     * Stores the given symbol in the predicate cache. The current size of the cache
     * defines its index, as used in predicate evaluation.
     *
     * @param predicate The symbol representing the predicate.
     */
    public definePredicate(predicate: BaseSymbol): void {
        if (predicate instanceof LexerPredicateSymbol) {
            this.lexerPredicates.push(predicate);
        } else {
            this.parserPredicates.push(predicate);
        }
    }

    /**
     * Does a depth-first search in the table for a symbol which contains the given context.
     * The search is based on the token indices which the context covers and goes down as much as possible to find
     * the closes covering symbol.
     *
     * @param context The context to search for.
     *
     * @returns The symbol covering the given context or undefined if nothing was found.
     */
    public symbolContainingContext(context: ParseTree): BaseSymbol | undefined {
        const findRecursive = (parent: ScopedSymbol): BaseSymbol | undefined => {
            for (const symbol of parent.children) {
                if (!symbol.context) {
                    continue;
                }

                if (symbol.context.getSourceInterval().properlyContains(context.getSourceInterval())) {
                    let child;
                    if (symbol instanceof ScopedSymbol) {
                        child = findRecursive(symbol);

                    }

                    if (child) {
                        return child;
                    } else {
                        return symbol;
                    }
                }
            }
        };

        return findRecursive(this);
    }

    /**
     * Collects a list of action symbols.
     *
     * @param type The type of actions to return.
     *
     * @returns BaseSymbol information for each defined action.
     */
    private actionListOfType(type: CodeActionType): BaseSymbol[] {
        switch (type) {
            case CodeActionType.LocalNamed: {
                return this.namedActions.filter((symbol) => {
                    return symbol instanceof LocalNamedActionSymbol;
                });
            }

            case CodeActionType.ParserAction: {
                return this.parserActions;
            }

            case CodeActionType.LexerAction: {
                return this.lexerActions;

            }

            case CodeActionType.ParserPredicate: {
                return this.parserPredicates;

            }

            case CodeActionType.LexerPredicate: {
                return this.lexerPredicates;
            }

            default: {
                return this.namedActions.filter((symbol) => {
                    return symbol instanceof GlobalNamedActionSymbol;
                });
            }
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private symbolsOfType<T extends BaseSymbol, Args extends unknown[]>(t: SymbolConstructor<T, Args>,
        localOnly = false): ISymbolInfo[] {
        const result: ISymbolInfo[] = [];

        const symbols = this.getAllSymbolsSync(t, localOnly);
        const filtered = new Set(symbols); // Filter for duplicates.
        for (const symbol of filtered) {
            const root = symbol.root as ContextSymbolTable;
            result.push({
                kind: getKindFromSymbol(symbol),
                name: symbol.name,
                source: root.owner ? root.owner.fileName : "ANTLR runtime",
                definition: definitionForContext(symbol.context, true),
                description: undefined,
            });
        }

        return result;
    }

    private getSymbolOfType(name: string, kind: SymbolKind, localOnly: boolean): BaseSymbol | undefined {
        switch (kind) {
            case SymbolKind.TokenVocab: {
                const options = this.resolveSync("options", true);
                if (options) {
                    return options.resolveSync(name, localOnly);
                }

                break;
            }

            case SymbolKind.Import: {
                return this.resolveSync(name, localOnly) as ImportSymbol;
            }

            case SymbolKind.BuiltInLexerToken: {
                return this.resolveSync(name, localOnly) as BuiltInTokenSymbol;
            }

            case SymbolKind.VirtualLexerToken: {
                return this.resolveSync(name, localOnly) as VirtualTokenSymbol;
            }

            case SymbolKind.FragmentLexerToken: {
                return this.resolveSync(name, localOnly) as FragmentTokenSymbol;
            }

            case SymbolKind.LexerRule: {
                return this.resolveSync(name, localOnly) as TokenSymbol;
            }

            case SymbolKind.BuiltInMode: {
                return this.resolveSync(name, localOnly) as BuiltInModeSymbol;
            }

            case SymbolKind.LexerMode: {
                return this.resolveSync(name, localOnly) as LexerModeSymbol;
            }

            case SymbolKind.BuiltInChannel: {
                return this.resolveSync(name, localOnly) as BuiltInChannelSymbol;
            }

            case SymbolKind.TokenChannel: {
                return this.resolveSync(name, localOnly) as TokenChannelSymbol;
            }

            case SymbolKind.ParserRule: {
                return this.resolveSync(name, localOnly) as RuleSymbol;
            }

            default:
        }

        return undefined;
    }

}
