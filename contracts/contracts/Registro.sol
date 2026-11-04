// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract Registro is Ownable {
    struct Documento {
        bytes32 hash;
        address registrador;
        uint64 registradoEn;
        string uri;
        bool activo;
    }

    mapping(bytes32 => Documento) private _documentos;

    uint256 public total;

    event DocumentoRegistrado(bytes32 indexed hash, address indexed registrador, string uri);
    event DocumentoRevocado(bytes32 indexed hash, address indexed registrador);

    error HashInvalido();
    error DocumentoYaRegistrado(bytes32 hash);
    error DocumentoNoEncontrado(bytes32 hash);
    error DocumentoYaRevocado(bytes32 hash);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function registrar(bytes32 hash, string calldata uri) external onlyOwner {
        if (hash == bytes32(0)) revert HashInvalido();
        if (_documentos[hash].registrador != address(0)) revert DocumentoYaRegistrado(hash);

        _documentos[hash] = Documento({
            hash: hash,
            registrador: msg.sender,
            registradoEn: uint64(block.timestamp),
            uri: uri,
            activo: true
        });

        total += 1;
        emit DocumentoRegistrado(hash, msg.sender, uri);
    }

    function revocar(bytes32 hash) external onlyOwner {
        Documento storage documento = _documentos[hash];
        if (documento.registrador == address(0)) revert DocumentoNoEncontrado(hash);
        if (!documento.activo) revert DocumentoYaRevocado(hash);

        documento.activo = false;
        emit DocumentoRevocado(hash, msg.sender);
    }

    function obtener(bytes32 hash) external view returns (Documento memory) {
        Documento memory documento = _documentos[hash];
        if (documento.registrador == address(0)) revert DocumentoNoEncontrado(hash);
        return documento;
    }

    function existe(bytes32 hash) external view returns (bool) {
        return _documentos[hash].registrador != address(0);
    }
}
