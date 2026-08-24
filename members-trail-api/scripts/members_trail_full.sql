-- MySQL dump 10.13  Distrib 8.0.46, for Linux (x86_64)
--
-- Host: 127.0.0.1    Database: members_trail
-- ------------------------------------------------------
-- Server version	8.0.46-0ubuntu0.24.04.3

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `achievements`
--

DROP TABLE IF EXISTS `achievements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `achievements` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `code` varchar(64) NOT NULL,
  `title` varchar(160) NOT NULL,
  `description` text NOT NULL,
  `tier` enum('bronze','silver','gold','platinum') NOT NULL DEFAULT 'bronze',
  `rewardPoints` int NOT NULL DEFAULT '0',
  `criteria` json NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_cd74882f69ff37d7330e89c63d` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `achievements`
--

LOCK TABLES `achievements` WRITE;
/*!40000 ALTER TABLE `achievements` DISABLE KEYS */;
INSERT INTO `achievements` (`id`, `createdAt`, `updatedAt`, `code`, `title`, `description`, `tier`, `rewardPoints`, `criteria`, `active`) VALUES ('4aab8b7e-59fb-4201-91e8-3f87b1705116','2026-08-24 08:21:04.578685','2026-08-24 08:21:04.578685','staker','Staker','Open your first staking position.','bronze',300,'{\"value\": 1, \"metric\": \"stakes\"}',1),('4cc64134-5ca4-4544-a71c-d52b01573de9','2026-08-24 08:21:04.586022','2026-08-24 08:21:04.586022','diamond-hands','Diamond Hands','Hold a 180-day stake to maturity.','platinum',5000,'{\"value\": 180, \"metric\": \"stake_matured_days\"}',1),('4e3dd93d-5982-4be3-9607-80d29a441a5e','2026-08-24 08:21:04.575017','2026-08-24 08:21:04.575017','converter','Converter','Convert Points to MTT for the first time.','bronze',200,'{\"value\": 1, \"metric\": \"conversions\"}',1),('616c2071-550d-4e92-8e3a-4d510a6a96f6','2026-08-24 08:21:04.570383','2026-08-24 08:21:04.570383','century','Century','Play 100 sessions.','silver',750,'{\"value\": 100, \"metric\": \"sessions\"}',1),('c8c613bc-0e25-40cb-9709-0cfbdf2d06d9','2026-08-24 08:21:04.589306','2026-08-24 08:21:04.589306','community-builder','Community Builder','Refer ten active players.','gold',3000,'{\"value\": 10, \"metric\": \"referrals\"}',1),('e7620e4f-dd79-4449-8fe0-e6a3eb969c51','2026-08-24 08:21:04.582506','2026-08-24 08:21:04.582506','podium','Podium','Finish top three in any tournament.','gold',2500,'{\"value\": 3, \"metric\": \"tournament_rank\"}',1),('ed361570-3f63-47fd-bddf-ecc8c2be9486','2026-08-24 08:21:04.566477','2026-08-24 08:21:04.566477','first-blood','First Blood','Complete your first game session.','bronze',100,'{\"value\": 1, \"metric\": \"sessions\"}',1);
/*!40000 ALTER TABLE `achievements` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `approval_requests`
--

DROP TABLE IF EXISTS `approval_requests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `approval_requests` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `ref` varchar(32) NOT NULL,
  `kind` enum('conversion_rate','commission_plan','treasury_outflow','balance_adjustment','points_rule','staking_pool','user_status','legal_publish','role_assignment') NOT NULL,
  `targetId` varchar(64) DEFAULT NULL,
  `payload` json NOT NULL,
  `reason` text NOT NULL,
  `requestedById` varchar(255) NOT NULL,
  `approverId` varchar(255) DEFAULT NULL,
  `status` enum('pending','approved','rejected','expired','applied') NOT NULL DEFAULT 'pending',
  `decisionNote` text,
  `decidedAt` datetime(6) DEFAULT NULL,
  `appliedAt` datetime(6) DEFAULT NULL,
  `expiresAt` datetime(6) NOT NULL,
  `requiresHardwareKey` tinyint NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_899f9f67a4ab0960943be5e328` (`ref`),
  KEY `idx_approval_status_kind` (`status`,`kind`),
  KEY `idx_approval_status_expires` (`status`,`expiresAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `approval_requests`
--

LOCK TABLES `approval_requests` WRITE;
/*!40000 ALTER TABLE `approval_requests` DISABLE KEYS */;
/*!40000 ALTER TABLE `approval_requests` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `audit_logs`
--

DROP TABLE IF EXISTS `audit_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_logs` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `ref` varchar(32) NOT NULL,
  `actorId` varchar(255) DEFAULT NULL,
  `actorRole` varchar(60) DEFAULT NULL,
  `action` varchar(120) NOT NULL,
  `targetType` varchar(60) DEFAULT NULL,
  `targetId` varchar(64) DEFAULT NULL,
  `before` json DEFAULT NULL,
  `after` json DEFAULT NULL,
  `reason` text,
  `requiredSecondApproval` tinyint NOT NULL DEFAULT '0',
  `approvedById` varchar(255) DEFAULT NULL,
  `ip` varchar(45) DEFAULT NULL,
  `userAgent` varchar(400) DEFAULT NULL,
  `requestId` varchar(64) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_f2726b3b3c0882a668085182e3` (`ref`),
  KEY `idx_audit_target` (`targetType`,`targetId`),
  KEY `idx_audit_action` (`action`),
  KEY `idx_audit_actor_time` (`actorId`,`createdAt`),
  CONSTRAINT `fk_audit_actor` FOREIGN KEY (`actorId`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `audit_logs`
--

LOCK TABLES `audit_logs` WRITE;
/*!40000 ALTER TABLE `audit_logs` DISABLE KEYS */;
/*!40000 ALTER TABLE `audit_logs` ENABLE KEYS */;
UNLOCK TABLES;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER `trg_audit_logs_no_update` BEFORE UPDATE ON `audit_logs` FOR EACH ROW BEGIN
        IF COALESCE(@mt_maintenance, 0) <> 1 THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AUDIT_IMMUTABLE: audit_logs cannot be modified.';
        END IF;
      END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER `trg_audit_logs_no_delete` BEFORE DELETE ON `audit_logs` FOR EACH ROW BEGIN
        IF COALESCE(@mt_maintenance, 0) <> 1 THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AUDIT_IMMUTABLE: audit_logs cannot be deleted.';
        END IF;
      END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;

--
-- Table structure for table `chain_events`
--

DROP TABLE IF EXISTS `chain_events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `chain_events` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `contractAddress` varchar(42) NOT NULL,
  `contractName` varchar(60) NOT NULL,
  `eventName` varchar(80) NOT NULL,
  `blockNumber` bigint NOT NULL,
  `blockHash` varchar(66) NOT NULL,
  `blockTime` datetime(6) DEFAULT NULL,
  `txHash` varchar(66) NOT NULL,
  `logIndex` int NOT NULL,
  `args` json NOT NULL,
  `processedAt` datetime(6) DEFAULT NULL,
  `processAttempts` int NOT NULL DEFAULT '0',
  `processError` text,
  `orphaned` tinyint NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_event_tx_log` (`txHash`,`logIndex`),
  KEY `idx_event_processed` (`processedAt`),
  KEY `idx_event_name_block` (`eventName`,`blockNumber`),
  KEY `idx_event_block_orphaned` (`blockNumber`,`orphaned`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `chain_events`
--

LOCK TABLES `chain_events` WRITE;
/*!40000 ALTER TABLE `chain_events` DISABLE KEYS */;
/*!40000 ALTER TABLE `chain_events` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `cms_content`
--

DROP TABLE IF EXISTS `cms_content`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cms_content` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `key` varchar(120) NOT NULL,
  `locale` varchar(8) NOT NULL DEFAULT 'en',
  `content` json NOT NULL,
  `status` enum('draft','published') NOT NULL DEFAULT 'draft',
  `updatedById` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cms_key_locale` (`key`,`locale`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `cms_content`
--

LOCK TABLES `cms_content` WRITE;
/*!40000 ALTER TABLE `cms_content` DISABLE KEYS */;
/*!40000 ALTER TABLE `cms_content` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `commission_cap_usage`
--

DROP TABLE IF EXISTS `commission_cap_usage`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `commission_cap_usage` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `userId` varchar(255) NOT NULL,
  `monthKey` varchar(10) NOT NULL,
  `capAmount` decimal(20,2) NOT NULL DEFAULT '0.00',
  `usedAmount` decimal(20,2) NOT NULL DEFAULT '0.00',
  `cappedAwayAmount` decimal(20,2) NOT NULL DEFAULT '0.00',
  `trailingSpend` decimal(20,2) NOT NULL DEFAULT '0.00',
  `entryCount` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cap_user_month` (`userId`,`monthKey`),
  CONSTRAINT `fk_cap_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `commission_cap_usage`
--

LOCK TABLES `commission_cap_usage` WRITE;
/*!40000 ALTER TABLE `commission_cap_usage` DISABLE KEYS */;
/*!40000 ALTER TABLE `commission_cap_usage` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `commission_plans`
--

DROP TABLE IF EXISTS `commission_plans`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `commission_plans` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `version` int NOT NULL,
  `l1Bps` int NOT NULL DEFAULT '800',
  `l2Bps` int NOT NULL DEFAULT '300',
  `l3Bps` int NOT NULL DEFAULT '100',
  `maxDepth` tinyint NOT NULL DEFAULT '3',
  `eligibleTriggers` json NOT NULL,
  `monthlyCapAbsolute` decimal(20,2) NOT NULL DEFAULT '0.00',
  `capMultiplier` decimal(8,2) NOT NULL DEFAULT '5.00',
  `capBase` decimal(20,2) NOT NULL DEFAULT '0.00',
  `minAccountAgeDays` int NOT NULL DEFAULT '7',
  `minGameplaySessions` int NOT NULL DEFAULT '5',
  `status` enum('pending_approval','scheduled','active','superseded','rejected') NOT NULL DEFAULT 'pending_approval',
  `effectiveFrom` datetime(6) NOT NULL,
  `proposedById` varchar(255) NOT NULL,
  `approvedById` varchar(255) DEFAULT NULL,
  `approvedAt` datetime(6) DEFAULT NULL,
  `simulationSnapshot` json DEFAULT NULL,
  `rationale` text,
  PRIMARY KEY (`id`),
  KEY `idx_plan_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `commission_plans`
--

LOCK TABLES `commission_plans` WRITE;
/*!40000 ALTER TABLE `commission_plans` DISABLE KEYS */;
INSERT INTO `commission_plans` (`id`, `createdAt`, `updatedAt`, `version`, `l1Bps`, `l2Bps`, `l3Bps`, `maxDepth`, `eligibleTriggers`, `monthlyCapAbsolute`, `capMultiplier`, `capBase`, `minAccountAgeDays`, `minGameplaySessions`, `status`, `effectiveFrom`, `proposedById`, `approvedById`, `approvedAt`, `simulationSnapshot`, `rationale`) VALUES ('67053357-e0ce-4033-8605-ef20b32878ec','2026-08-24 08:21:04.481029','2026-08-24 08:21:04.481029',1,800,300,100,3,'[\"iap\", \"tournament_entry\", \"subscription\"]',50000.00,5.00,1000.00,7,5,'active','2026-08-24 08:21:04.479000','eb013524-5668-4248-9b42-2af536f5f7ab','ef59688c-7ab0-4bc8-8f92-0a59cd725e43','2026-08-24 08:21:04.479000','{\"note\": \"Re-simulate before the first plan change; approval will refuse an insolvent plan\", \"basis\": \"No historical revenue at seed time, so no projection was possible\", \"seeded\": true}','Launch plan: 8/3/1 to three levels, capped monthly with no carry-over.');
/*!40000 ALTER TABLE `commission_plans` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `commissions`
--

DROP TABLE IF EXISTS `commissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `commissions` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `ref` varchar(32) NOT NULL,
  `recipientId` varchar(255) NOT NULL,
  `downlineUserId` varchar(255) NOT NULL,
  `level` tinyint NOT NULL,
  `revenueEventId` varchar(255) NOT NULL,
  `triggerType` enum('iap','tournament_entry','subscription') NOT NULL,
  `eligibleSpend` decimal(20,2) NOT NULL DEFAULT '0.00',
  `rateBps` int NOT NULL,
  `amount` decimal(20,2) NOT NULL DEFAULT '0.00',
  `grossAmount` decimal(20,2) NOT NULL DEFAULT '0.00',
  `cappedAmount` decimal(20,2) NOT NULL DEFAULT '0.00',
  `amountMtt` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `status` enum('pending_kyc','queued','released','claimed','capped','clawed_back','rejected') NOT NULL DEFAULT 'pending_kyc',
  `treasuryInflowRef` varchar(32) DEFAULT NULL,
  `treasuryOutflowId` varchar(255) DEFAULT NULL,
  `sourceEventId` varchar(66) DEFAULT NULL,
  `txHash` varchar(66) DEFAULT NULL,
  `monthKey` varchar(10) NOT NULL,
  `releasedAt` datetime(6) DEFAULT NULL,
  `claimedAt` datetime(6) DEFAULT NULL,
  `clawedBackAt` datetime(6) DEFAULT NULL,
  `clawbackReason` varchar(255) DEFAULT NULL,
  `rejectionReason` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_8412784406a67c8f1a4f308dc8` (`ref`),
  UNIQUE KEY `uq_commission_event_recipient` (`revenueEventId`,`recipientId`),
  KEY `idx_comm_created` (`createdAt`),
  KEY `idx_comm_downline` (`downlineUserId`),
  KEY `idx_comm_status` (`status`),
  KEY `idx_comm_recipient_month` (`recipientId`,`monthKey`),
  KEY `idx_comm_recipient_status` (`recipientId`,`status`),
  KEY `idx_comm_month_status` (`monthKey`,`status`),
  KEY `idx_comm_created_status_level` (`createdAt`,`status`,`level`),
  KEY `fk_comm_outflow` (`treasuryOutflowId`),
  CONSTRAINT `FK_60d4875dc4b6aa031c45cbf64ce` FOREIGN KEY (`recipientId`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_comm_downline` FOREIGN KEY (`downlineUserId`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_comm_outflow` FOREIGN KEY (`treasuryOutflowId`) REFERENCES `treasury_outflows` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_comm_revenue` FOREIGN KEY (`revenueEventId`) REFERENCES `revenue_events` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `commissions`
--

LOCK TABLES `commissions` WRITE;
/*!40000 ALTER TABLE `commissions` DISABLE KEYS */;
/*!40000 ALTER TABLE `commissions` ENABLE KEYS */;
UNLOCK TABLES;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER `trg_commission_depth_insert` BEFORE INSERT ON `commissions` FOR EACH ROW BEGIN
        IF NEW.level < 1 OR NEW.level > 3 THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'COMMISSION_DEPTH: level must be 1, 2 or 3.';
        END IF;
        IF NEW.recipientId = NEW.downlineUserId THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'SELF_REFERRAL: a member cannot earn commission on their own spend.';
        END IF;
      END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER `trg_commission_depth_update` BEFORE UPDATE ON `commissions` FOR EACH ROW BEGIN
        IF NEW.level < 1 OR NEW.level > 3 THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'COMMISSION_DEPTH: level must be 1, 2 or 3.';
        END IF;
      END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER `trg_commissions_no_delete` BEFORE DELETE ON `commissions` FOR EACH ROW BEGIN
        IF COALESCE(@mt_maintenance, 0) <> 1 THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'AUDIT_IMMUTABLE: commissions cannot be deleted. Claw back instead.';
        END IF;
      END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;

--
-- Table structure for table `conversion_rates`
--

DROP TABLE IF EXISTS `conversion_rates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `conversion_rates` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `pointsPerMtt` int NOT NULL,
  `effectiveFrom` datetime(6) NOT NULL,
  `status` enum('pending_approval','scheduled','active','superseded','rejected') NOT NULL DEFAULT 'pending_approval',
  `proposedById` varchar(255) NOT NULL,
  `approvedById` varchar(255) DEFAULT NULL,
  `approvedAt` datetime(6) DEFAULT NULL,
  `rationale` text,
  `rejectionReason` text,
  PRIMARY KEY (`id`),
  KEY `idx_rate_effective` (`effectiveFrom`),
  KEY `idx_rate_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `conversion_rates`
--

LOCK TABLES `conversion_rates` WRITE;
/*!40000 ALTER TABLE `conversion_rates` DISABLE KEYS */;
INSERT INTO `conversion_rates` (`id`, `createdAt`, `updatedAt`, `pointsPerMtt`, `effectiveFrom`, `status`, `proposedById`, `approvedById`, `approvedAt`, `rationale`, `rejectionReason`) VALUES ('b4c6f3e5-2882-4db4-9cde-bcad1eb8d30f','2026-08-24 08:21:04.474808','2026-08-24 08:21:04.474808',1000,'2026-08-24 08:21:04.473000','active','eb013524-5668-4248-9b42-2af536f5f7ab','ef59688c-7ab0-4bc8-8f92-0a59cd725e43','2026-08-24 08:21:04.473000','Launch rate, seeded. Any change goes through propose → approve.',NULL);
/*!40000 ALTER TABLE `conversion_rates` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `conversions`
--

DROP TABLE IF EXISTS `conversions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `conversions` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `ref` varchar(32) NOT NULL,
  `userId` varchar(255) NOT NULL,
  `pointsSpent` bigint NOT NULL,
  `rateApplied` int NOT NULL,
  `mttCredited` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `status` enum('pending','queued','processing','review','completed','failed','cancelled') NOT NULL DEFAULT 'pending',
  `transactionId` varchar(255) DEFAULT NULL,
  `txHash` varchar(66) DEFAULT NULL,
  `idempotencyKey` varchar(128) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_730d8e80e48ddca573c6e5ba4c` (`ref`),
  UNIQUE KEY `uq_conv_idem` (`idempotencyKey`),
  KEY `idx_conv_user_time` (`userId`,`createdAt`),
  KEY `idx_conv_status_created` (`status`,`createdAt`),
  KEY `fk_conv_tx` (`transactionId`),
  CONSTRAINT `fk_conv_tx` FOREIGN KEY (`transactionId`) REFERENCES `transactions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_conv_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `conversions`
--

LOCK TABLES `conversions` WRITE;
/*!40000 ALTER TABLE `conversions` DISABLE KEYS */;
/*!40000 ALTER TABLE `conversions` ENABLE KEYS */;
UNLOCK TABLES;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER `trg_conversion_rate_sane` BEFORE INSERT ON `conversions` FOR EACH ROW BEGIN
        IF NEW.rateApplied <= 0 THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RATE_INVALID: rateApplied must be positive.';
        END IF;
        IF NEW.pointsSpent <= 0 THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'POINTS_INVALID: pointsSpent must be positive.';
        END IF;
      END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;

--
-- Table structure for table `deposits`
--

DROP TABLE IF EXISTS `deposits`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `deposits` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `ref` varchar(32) NOT NULL,
  `userId` varchar(255) NOT NULL,
  `method` enum('card','upi','bank','crypto') NOT NULL,
  `amountFiat` decimal(20,2) NOT NULL DEFAULT '0.00',
  `currency` varchar(3) NOT NULL DEFAULT 'INR',
  `amountMtt` decimal(36,18) DEFAULT NULL,
  `processor` varchar(60) DEFAULT NULL,
  `processorRef` varchar(128) DEFAULT NULL,
  `status` enum('initiated','pending','processing','completed','failed','expired','refunded') NOT NULL DEFAULT 'initiated',
  `reconciledAt` datetime(6) DEFAULT NULL,
  `settledAt` datetime(6) DEFAULT NULL,
  `txHash` varchar(66) DEFAULT NULL,
  `processorPayload` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_607b435cdc01b672cc67687c8f` (`ref`),
  UNIQUE KEY `IDX_02aa17f7a1839f2081012928e3` (`processorRef`),
  KEY `idx_dep_processor_ref` (`processorRef`),
  KEY `idx_dep_user_time` (`userId`,`createdAt`),
  CONSTRAINT `fk_dep_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `deposits`
--

LOCK TABLES `deposits` WRITE;
/*!40000 ALTER TABLE `deposits` DISABLE KEYS */;
/*!40000 ALTER TABLE `deposits` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `fraud_alerts`
--

DROP TABLE IF EXISTS `fraud_alerts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fraud_alerts` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `ref` varchar(32) NOT NULL,
  `kind` enum('velocity','structuring','self_referral_ring','bot_farming','multi_account','device_cluster','impossible_travel','cap_hugging') NOT NULL,
  `severity` enum('low','medium','high','critical') NOT NULL,
  `riskScore` int NOT NULL,
  `affectedUserIds` json NOT NULL,
  `summary` text NOT NULL,
  `signals` json NOT NULL,
  `evidence` json DEFAULT NULL,
  `status` enum('open','investigating','actioned','dismissed') NOT NULL DEFAULT 'open',
  `assigneeId` varchar(255) DEFAULT NULL,
  `resolutionNote` text,
  `resolvedAt` datetime(6) DEFAULT NULL,
  `dedupeKey` varchar(128) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_d0be7a8b81436db4b9357693c0` (`ref`),
  KEY `idx_fraud_dedupe` (`dedupeKey`),
  KEY `idx_fraud_created` (`createdAt`),
  KEY `idx_fraud_status_sev` (`status`,`severity`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `fraud_alerts`
--

LOCK TABLES `fraud_alerts` WRITE;
/*!40000 ALTER TABLE `fraud_alerts` DISABLE KEYS */;
/*!40000 ALTER TABLE `fraud_alerts` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `fraud_rules`
--

DROP TABLE IF EXISTS `fraud_rules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fraud_rules` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `code` varchar(64) NOT NULL,
  `name` varchar(160) NOT NULL,
  `description` text NOT NULL,
  `kind` enum('velocity','structuring','self_referral_ring','bot_farming','multi_account','device_cluster','impossible_travel','cap_hugging') NOT NULL,
  `thresholds` json NOT NULL,
  `enabled` tinyint NOT NULL DEFAULT '1',
  `autoFreeze` tinyint NOT NULL DEFAULT '0',
  `baseRiskScore` int NOT NULL DEFAULT '50',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_fraud_rule_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `fraud_rules`
--

LOCK TABLES `fraud_rules` WRITE;
/*!40000 ALTER TABLE `fraud_rules` DISABLE KEYS */;
INSERT INTO `fraud_rules` (`id`, `createdAt`, `updatedAt`, `code`, `name`, `description`, `kind`, `thresholds`, `enabled`, `autoFreeze`, `baseRiskScore`) VALUES ('3883b9f5-0352-4e25-a02c-da907d206a30','2026-08-24 08:21:04.643219','2026-08-24 08:21:04.643219','FR-IMPOSSIBLE-TRAVEL','Impossible travel','Sign-ins from locations no traveller could cover in the time between them.','impossible_travel','{\"maxKmPerHour\": 900}',1,0,55),('48718b1c-a6f7-4377-ab69-22be5c1c6db1','2026-08-24 08:21:04.632786','2026-08-24 08:21:04.632786','FR-BOT-FARMING','Bot farming','High session volume with implausibly short durations.','bot_farming','{\"minSessions\": 60, \"windowHours\": 24, \"maxMedianDurationMs\": 4000}',1,0,70),('50daa5bc-7069-49d3-bfae-1005fd6d5cf1','2026-08-24 08:21:04.629560','2026-08-24 08:21:04.629560','FR-SELF-REFERRAL','Mutual referral ring','Accounts referring each other, which manufactures commission from no real spend.','self_referral_ring','{\"minMutualPairs\": 1}',1,0,80),('5ff7cc63-f620-429b-a004-4d0acf517104','2026-08-24 08:21:04.647063','2026-08-24 08:21:04.647063','FR-CAP-HUGGING','Cap hugging','An account earning exactly to its daily cap, day after day — automation, not play.','cap_hugging','{\"windowDays\": 7, \"minDaysAtCap\": 6}',1,0,50),('83ab733c-2902-4e5c-871e-9a3362dd934a','2026-08-24 08:21:04.625126','2026-08-24 08:21:04.625126','FR-STRUCTURING','Structuring','Repeated withdrawals sized just under the review threshold. Each is individually compliant; the intent shows in the sequence.','structuring','{\"minCount\": 3, \"windowHours\": 24, \"withinPctOfThreshold\": 95}',1,0,75),('8e0af0a4-fdf4-46b4-832b-0f7ff2260a40','2026-08-24 08:21:04.621076','2026-08-24 08:21:04.621076','FR-VELOCITY','Withdrawal velocity','Many withdrawal requests in a short window — the signature of an account being drained.','velocity','{\"windowMinutes\": 60, \"maxWithdrawals\": 5}',1,0,60),('e017e076-ba64-4b05-96ce-32dfad61f18d','2026-08-24 08:21:04.635895','2026-08-24 08:21:04.635895','FR-MULTI-ACCOUNT','Multi-accounting','Several accounts sharing a device fingerprint.','multi_account','{\"windowDays\": 30, \"maxAccountsPerDevice\": 3}',1,0,65),('e9147a85-dc81-416d-823a-1df0a7198630','2026-08-24 08:21:04.639396','2026-08-24 08:21:04.639396','FR-DEVICE-CLUSTER','Device cluster','A larger cluster of accounts on one device, typical of a farm.','device_cluster','{\"windowDays\": 7, \"maxAccountsPerDevice\": 5}',1,0,70);
/*!40000 ALTER TABLE `fraud_rules` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `game_sessions`
--

DROP TABLE IF EXISTS `game_sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_sessions` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `ref` varchar(32) NOT NULL,
  `userId` varchar(255) NOT NULL,
  `gameId` varchar(255) NOT NULL,
  `tournamentId` varchar(255) DEFAULT NULL,
  `mode` enum('free','paid','tournament','demo') NOT NULL DEFAULT 'free',
  `seed` varchar(64) NOT NULL,
  `sessionSecret` varchar(64) NOT NULL,
  `startedAt` datetime(6) NOT NULL,
  `endedAt` datetime(6) DEFAULT NULL,
  `durationMs` int DEFAULT NULL,
  `clientScore` int DEFAULT NULL,
  `serverScore` int DEFAULT NULL,
  `status` enum('open','submitted','validated','rejected','abandoned') NOT NULL DEFAULT 'open',
  `pointsAwarded` int NOT NULL DEFAULT '0',
  `rejectionReason` varchar(255) DEFAULT NULL,
  `telemetryHash` varchar(64) DEFAULT NULL,
  `telemetryFrames` int NOT NULL DEFAULT '0',
  `anomalyFlags` json DEFAULT NULL,
  `ip` varchar(45) DEFAULT NULL,
  `deviceFingerprint` varchar(128) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_89bf17ae9805a26cc655f0604a` (`ref`),
  KEY `idx_session_fingerprint` (`deviceFingerprint`),
  KEY `idx_session_game` (`gameId`),
  KEY `idx_session_status` (`status`),
  KEY `idx_session_user_time` (`userId`,`createdAt`),
  KEY `idx_session_user_status` (`userId`,`status`),
  KEY `idx_session_status_created` (`status`,`createdAt`),
  KEY `idx_session_fp_created` (`deviceFingerprint`,`createdAt`,`userId`),
  CONSTRAINT `fk_session_game` FOREIGN KEY (`gameId`) REFERENCES `games` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_session_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `game_sessions`
--

LOCK TABLES `game_sessions` WRITE;
/*!40000 ALTER TABLE `game_sessions` DISABLE KEYS */;
/*!40000 ALTER TABLE `game_sessions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `games`
--

DROP TABLE IF EXISTS `games`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `games` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `slug` varchar(64) NOT NULL,
  `title` varchar(120) NOT NULL,
  `genre` varchar(40) NOT NULL,
  `blurb` text NOT NULL,
  `thumbnailHue` int NOT NULL DEFAULT '24',
  `pointsPerSessionMin` int NOT NULL DEFAULT '0',
  `pointsPerSessionMax` int NOT NULL DEFAULT '0',
  `entryType` enum('free','paid','both') NOT NULL DEFAULT 'free',
  `entryFee` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `dailyPointsCap` int NOT NULL DEFAULT '3000',
  `sessionPointsCap` int NOT NULL DEFAULT '1000',
  `active` tinyint NOT NULL DEFAULT '1',
  `rating` decimal(3,2) NOT NULL DEFAULT '0.00',
  `players30d` int NOT NULL DEFAULT '0',
  `scoringConfig` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_095bbaa4f028fa5a03e37f631d` (`slug`),
  KEY `idx_game_active` (`active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `games`
--

LOCK TABLES `games` WRITE;
/*!40000 ALTER TABLE `games` DISABLE KEYS */;
INSERT INTO `games` (`id`, `createdAt`, `updatedAt`, `slug`, `title`, `genre`, `blurb`, `thumbnailHue`, `pointsPerSessionMin`, `pointsPerSessionMax`, `entryType`, `entryFee`, `dailyPointsCap`, `sessionPointsCap`, `active`, `rating`, `players30d`, `scoringConfig`) VALUES ('4667b186-ba80-46b6-a773-be826bc4aaeb','2026-08-24 08:21:04.524191','2026-08-24 08:21:04.524191','word-vault','Word Vault','Word','Vocabulary sprints with daily seeded boards — everyone plays the same board.',233,80,480,'both',3.000000000000000000,2500,700,1,0.00,0,NULL),('55a74852-ca5a-4825-bb96-98e15902b768','2026-08-24 08:21:04.513195','2026-08-24 08:21:04.513195','turbo-drift','Turbo Drift','Racing','Time-trial circuit racing with ghost replays and weekly track rotation.',104,100,560,'both',8.000000000000000000,3000,800,1,0.00,0,NULL),('61b68061-9127-452b-ab73-499034009aed','2026-08-24 08:21:04.520211','2026-08-24 08:21:04.520211','sky-siege','Sky Siege','Action','Wave-defence shooter with escalating difficulty tiers.',190,110,640,'free',0.000000000000000000,3200,950,1,0.00,0,NULL),('875e749f-324a-41b6-a916-e240c8cd0bf3','2026-08-24 08:21:04.504750','2026-08-24 08:21:04.504750','neon-rush','Neon Rush','Arcade','Endless runner through a synth-lit city. Reflex scoring with combo multipliers.',18,90,620,'both',5.000000000000000000,3000,900,1,0.00,0,NULL),('9884c7bb-8388-4edb-b1a5-86fe269935cf','2026-08-24 08:21:04.508979','2026-08-24 08:21:04.508979','cipher-break','Cipher Break','Puzzle','Timed logic puzzles. Pure skill, no randomness — the flagship ranked title.',61,120,780,'free',0.000000000000000000,4000,1100,1,0.00,0,NULL),('a1a4e952-0d99-4ddd-ae22-63c57d653f30','2026-08-24 08:21:04.531233','2026-08-24 08:21:04.531233','pulse-beat','Pulse Beat','Rhythm','Beat-matching with community-charted tracks and accuracy grading.',319,100,700,'free',0.000000000000000000,3000,1000,0,0.00,0,NULL),('f0e665eb-b489-42b1-919b-17a4105945b6','2026-08-24 08:21:04.527787','2026-08-24 08:21:04.527787','hex-tactics','Hex Tactics','Strategy','Turn-based skirmish on hex grids. Elo-rated ladder.',276,150,850,'both',15.000000000000000000,5000,1400,1,0.00,0,NULL),('fee27049-93ec-49c3-81a8-fbbdb51567f7','2026-08-24 08:21:04.517076','2026-08-24 08:21:04.517076','block-forge','Block Forge','Strategy','Tile-placement builder. Deep scoring ceiling rewards long-term mastery.',147,140,900,'both',12.000000000000000000,4500,1300,1,0.00,0,NULL);
/*!40000 ALTER TABLE `games` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `idempotency_keys`
--

DROP TABLE IF EXISTS `idempotency_keys`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `idempotency_keys` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `scope` varchar(60) NOT NULL,
  `key` varchar(191) NOT NULL,
  `userId` varchar(255) DEFAULT NULL,
  `resultRef` varchar(64) DEFAULT NULL,
  `expiresAt` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_idem_scope_key` (`scope`,`key`),
  KEY `idx_idem_expires` (`expiresAt`),
  KEY `fk_idem_user` (`userId`),
  CONSTRAINT `fk_idem_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `idempotency_keys`
--

LOCK TABLES `idempotency_keys` WRITE;
/*!40000 ALTER TABLE `idempotency_keys` DISABLE KEYS */;
/*!40000 ALTER TABLE `idempotency_keys` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `indexer_cursors`
--

DROP TABLE IF EXISTS `indexer_cursors`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `indexer_cursors` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `cursorKey` varchar(120) NOT NULL,
  `lastBlock` bigint NOT NULL,
  `lastBlockHash` varchar(66) DEFAULT NULL,
  `reorgCount` int NOT NULL DEFAULT '0',
  `lastRunAt` datetime(6) DEFAULT NULL,
  `lastError` text,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cursor_key` (`cursorKey`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `indexer_cursors`
--

LOCK TABLES `indexer_cursors` WRITE;
/*!40000 ALTER TABLE `indexer_cursors` DISABLE KEYS */;
/*!40000 ALTER TABLE `indexer_cursors` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `kyc_access_log`
--

DROP TABLE IF EXISTS `kyc_access_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `kyc_access_log` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `documentId` varchar(255) NOT NULL,
  `actorId` varchar(255) NOT NULL,
  `ip` varchar(45) DEFAULT NULL,
  `reason` varchar(120) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_kycaccess_actor` (`actorId`,`createdAt`),
  KEY `idx_kycaccess_doc` (`documentId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `kyc_access_log`
--

LOCK TABLES `kyc_access_log` WRITE;
/*!40000 ALTER TABLE `kyc_access_log` DISABLE KEYS */;
/*!40000 ALTER TABLE `kyc_access_log` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `kyc_documents`
--

DROP TABLE IF EXISTS `kyc_documents`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `kyc_documents` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `submissionId` varchar(255) NOT NULL,
  `kind` enum('id_front','id_back','selfie','address_proof','source_of_funds') NOT NULL,
  `storageKeyEnc` text NOT NULL,
  `mimeType` varchar(100) NOT NULL,
  `sizeBytes` int NOT NULL,
  `sha256` varchar(64) NOT NULL,
  `purgedAt` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_kycdoc_submission` (`submissionId`),
  CONSTRAINT `fk_kycdoc_sub` FOREIGN KEY (`submissionId`) REFERENCES `kyc_submissions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `kyc_documents`
--

LOCK TABLES `kyc_documents` WRITE;
/*!40000 ALTER TABLE `kyc_documents` DISABLE KEYS */;
/*!40000 ALTER TABLE `kyc_documents` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `kyc_submissions`
--

DROP TABLE IF EXISTS `kyc_submissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `kyc_submissions` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `ref` varchar(32) NOT NULL,
  `userId` varchar(255) NOT NULL,
  `tier` tinyint NOT NULL,
  `status` enum('pending','in_review','approved','rejected','more_info') NOT NULL DEFAULT 'pending',
  `provider` varchar(60) DEFAULT NULL,
  `providerRef` varchar(128) DEFAULT NULL,
  `providerConfidence` int DEFAULT NULL,
  `riskScore` int NOT NULL DEFAULT '0',
  `country` varchar(2) DEFAULT NULL,
  `reviewedById` varchar(255) DEFAULT NULL,
  `reviewedAt` datetime(6) DEFAULT NULL,
  `reviewerNotes` text,
  `rejectionReason` text,
  `sarFiledAt` datetime(6) DEFAULT NULL,
  `retentionUntil` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_a0a58f6b7a26ec3fad6d6c6ff2` (`ref`),
  KEY `idx_kyc_user` (`userId`),
  KEY `idx_kyc_status` (`status`),
  KEY `idx_kyc_created_status` (`createdAt`,`status`),
  CONSTRAINT `fk_kyc_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `kyc_submissions`
--

LOCK TABLES `kyc_submissions` WRITE;
/*!40000 ALTER TABLE `kyc_submissions` DISABLE KEYS */;
/*!40000 ALTER TABLE `kyc_submissions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `leaderboard_snapshots`
--

DROP TABLE IF EXISTS `leaderboard_snapshots`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `leaderboard_snapshots` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `metric` varchar(32) NOT NULL,
  `periodKey` varchar(16) NOT NULL,
  `userId` varchar(255) NOT NULL,
  `score` bigint NOT NULL,
  `rank` int NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_lb_snapshot` (`metric`,`periodKey`,`userId`),
  KEY `idx_lb_lookup` (`metric`,`periodKey`,`rank`),
  KEY `fk_lb_user` (`userId`),
  CONSTRAINT `fk_lb_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `leaderboard_snapshots`
--

LOCK TABLES `leaderboard_snapshots` WRITE;
/*!40000 ALTER TABLE `leaderboard_snapshots` DISABLE KEYS */;
/*!40000 ALTER TABLE `leaderboard_snapshots` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `legal_documents`
--

DROP TABLE IF EXISTS `legal_documents`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `legal_documents` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `slug` varchar(64) NOT NULL,
  `title` varchar(200) NOT NULL,
  `version` varchar(20) NOT NULL,
  `status` enum('draft','legal_review','published','archived') NOT NULL DEFAULT 'draft',
  `summary` text NOT NULL,
  `sections` json NOT NULL,
  `materialChange` tinyint NOT NULL DEFAULT '0',
  `effectiveFrom` datetime(6) DEFAULT NULL,
  `publishedAt` datetime(6) DEFAULT NULL,
  `authoredById` varchar(255) DEFAULT NULL,
  `approvedById` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_legal_slug_version` (`slug`,`version`),
  KEY `idx_legal_status` (`slug`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `legal_documents`
--

LOCK TABLES `legal_documents` WRITE;
/*!40000 ALTER TABLE `legal_documents` DISABLE KEYS */;
INSERT INTO `legal_documents` (`id`, `createdAt`, `updatedAt`, `slug`, `title`, `version`, `status`, `summary`, `sections`, `materialChange`, `effectiveFrom`, `publishedAt`, `authoredById`, `approvedById`) VALUES ('2a0e337e-235d-48bb-961c-6d32f4877abb','2026-08-24 08:21:04.672503','2026-08-24 08:21:04.672503','aml-kyc','AML / KYC Policy','1.0','legal_review','To withdraw or to receive referral commission you must complete Tier 1 verification: a government ID plus a liveness selfie. Tier 2 adds proof of address and is triggered once your cumulative withdrawals pass the published threshold. A new withdrawal address is held for 24 to 48 hours before its first payout, larger or unusual withdrawals get a manual review, and every withdrawal is tagged with where the money came from. Your documents are encrypted, visible only to Compliance, access-logged, and kept for about five years because AML law requires it.','[{\"body\": [\"Members Trail is committed to preventing money laundering, terrorist financing, sanctions evasion and fraud on its platform. This policy sets out the customer due diligence, monitoring, screening, reporting and record-keeping controls that support that commitment, and the obligations it places on you as a member.\", \"The controls are modelled on the FATF recommendations and the risk-based approach they require, and will be mapped to the specific statutory framework of each launch jurisdiction before that market opens. Where a local rule is stricter than what is described here, the local rule applies to members in that jurisdiction.\", \"Two design decisions shape everything below. First, the platform pays out real money, so the payout path is where the controls concentrate: verification, address controls, source tagging and manual review all sit around withdrawal and commission release. Second, the referral programme creates a network of financial relationships between members, which is a fraud surface in its own right and is monitored as one.\"], \"heading\": \"1. Purpose and regulatory basis\"}, {\"body\": [\"Tier 1 is the baseline. It requires a valid government-issued photo identity document — passport, national identity card or driving licence — and a liveness selfie captured in-session. Our verification provider authenticates the document, extracts and matches the data to your declared details, confirms the selfie is a live capture rather than a photograph or a deepfake, and matches the face to the document image.\", \"Tier 1 must be complete before your first withdrawal and before any referral commission is released to you. Commission continues to accrue and is shown in your payout history as awaiting verification; it is not lost while you are unverified, and it is not payable until you are.\", \"Tier 1 also confirms your age and your declared country of residence. A date of birth below the applicable minimum age closes the account under the Terms. A country that does not match your declared residence, or that is on the restricted list, escalates to manual review before anything is released.\"], \"heading\": \"2. Customer due diligence — Tier 1\"}, {\"body\": [\"Tier 2 is triggered when your cumulative lifetime withdrawals cross the published threshold, when a single withdrawal exceeds the large-transaction limit, when monitoring raises an alert on your account, when screening returns a possible match, or when your activity profile does not fit your stated circumstances.\", \"Tier 2 requires proof of address dated within the last three months — a utility bill, bank statement or government correspondence — and, where the risk assessment calls for it, evidence of source of funds or source of wealth. For a member whose balance came from gameplay and staking, that evidence is largely already on our own ledger; the request is aimed at cases where value entered from outside.\", \"Withdrawals above the Tier 2 threshold are held until Tier 2 is complete. We tell you exactly which documents are needed and the expected review time, and a rejected document is explained specifically enough that you can fix it rather than guess.\"], \"heading\": \"3. Enhanced due diligence — Tier 2\"}, {\"body\": [\"The first time you add a withdrawal destination — a bank account or an on-chain address — it enters a cooling-off period of 24 to 48 hours before a payout to it can be released. The delay is deliberate friction against account takeover: an attacker who gets into an account cannot immediately redirect funds to their own address, and the notification we send you about the new destination arrives while there is still time to stop it.\", \"During the cooling-off period the destination is visible in your wallet settings as pending, and any withdrawal queued to it stays queued. You can cancel a pending destination at any time, and cancelling it also cancels the queued withdrawal.\", \"Additional address controls apply: a limit on how many active destinations an account may hold, a re-verification step when a destination is changed shortly after a password or two-factor change, and a block on destinations that appear on our internal deny list or that are linked to another member\'s account.\"], \"heading\": \"4. Withdrawal address controls and cooling-off\"}, {\"body\": [\"Every withdrawal is tagged with the origin of the value being withdrawn: gameplay (Points converted to MTT), staking (principal returned and rewards accrued), referral commission, or a returned deposit. Where a withdrawal draws on more than one origin, the tag records the proportion from each.\", \"Source tagging does three jobs. It lets monitoring apply different risk rules to different origins, because a large withdrawal of returned deposits is a different signal from a large withdrawal of referral commission. It makes the deposit-to-withdrawal path visible so that a member cycling money through the platform stands out. And it supports the platform\'s core representation that payouts are revenue-funded, by tying each commission line to the Treasury deposit reference that funded it.\", \"The tags are shown to you in your transaction history, not just held internally. If a tag looks wrong, raise it through /contact and we will trace and correct it.\"], \"heading\": \"5. Withdrawal source tagging\"}, {\"body\": [\"Automated rules run continuously over deposits, purchases, conversions, staking actions, commissions and withdrawals. They cover velocity — unusual frequency or size relative to your own history and to peers; structuring — several transactions just under a threshold; rapid cycling of deposits into withdrawals with little or no gameplay; and mismatches between country, IP geolocation and device.\", \"Referral-network detection is a distinct set of rules: clusters of accounts sharing a device fingerprint, payment instrument or address; circular referral structures; downlines whose spend is concentrated in a short burst around a cap reset; sign-up bursts from one IP range; and downlines with no genuine gameplay behind their spend.\", \"An alert opens a case with a risk score, the triggering rule and the supporting evidence. A low-scoring case may resolve automatically with an audit record. A high-scoring case goes to a compliance analyst and can pause withdrawals or commission release while it is open. We do not publish the specific thresholds, because publishing them would tell the people we are looking for exactly where to sit.\"], \"heading\": \"6. Ongoing monitoring\"}, {\"body\": [\"At verification and periodically afterwards, members are screened against the sanctions and consolidated lists applicable to our operating entity and its payment partners, against politically exposed person databases, and against adverse media where the risk assessment requires it.\", \"A confirmed sanctions match means we cannot provide the service: the account is blocked, funds are frozen, no payout is made, and the matter is reported where the law requires. A possible match is reviewed by an analyst against the underlying record before any action, because false positives on common names are frequent and freezing the wrong person\'s balance is its own harm.\", \"A PEP match does not block an account. It raises the risk rating, requires enhanced due diligence including source of funds, and requires senior compliance approval to continue the relationship, with more frequent periodic review afterwards.\"], \"heading\": \"7. Sanctions and PEP screening\"}, {\"body\": [\"Manual review by a compliance analyst is mandatory, regardless of automated scoring, for a withdrawal above the large-transaction threshold, a first withdrawal by a newly verified account above the small-value limit, a commission release to an account whose downline generated an unusual share of the platform\'s spend that month, any case where screening returned a possible match, and any account with an open fraud case.\", \"Analysts work from a queue that shows the case evidence, the account\'s full history, the source tags and the referral graph, and they must record a written rationale to approve or reject. Approvals above a higher second threshold need a second approver, and no analyst can approve a case affecting an account they are connected to.\", \"Manual review adds time and we would rather be honest about that than pretend it is instant. Expected review windows are published in the withdrawal flow, and you are told when your case is queued, when it is being reviewed and what the outcome is.\"], \"heading\": \"8. Manual review thresholds\"}, {\"body\": [\"Any staff member who sees something suspicious must escalate it internally to the Compliance Officer, and escalation is a duty rather than a discretion. There is no threshold below which a genuine suspicion is ignored, and no commercial consideration — the size of the member\'s spend, the size of their downline — is a reason not to escalate.\", \"The Compliance Officer reviews the case, gathers the transaction and verification record, and decides whether the suspicion is reasonable. Where it is, and where the law of the relevant jurisdiction requires it, a suspicious activity or suspicious transaction report is filed with the competent Financial Intelligence Unit within the statutory deadline, with the supporting evidence preserved.\", \"Where a report has been filed, tipping off is prohibited. That means we may be legally unable to tell you that a report exists, or to explain the real reason a hold is in place, even when we would otherwise want to be transparent with you. We will still tell you that a hold exists and what, if anything, you can do.\", \"Filing a report does not by itself mean an account is closed. Some accounts continue under enhanced monitoring on the instruction or with the knowledge of the authority.\"], \"heading\": \"9. Suspicious activity reporting\"}, {\"body\": [\"We may freeze a balance, hold a withdrawal, pause commission release, restrict paid features or suspend an account where we have a reasonable suspicion of money laundering, fraud, sanctions breach or a serious breach of the Terms, where verification has failed or been abandoned, or where a legal order or a regulator requires it.\", \"A freeze is a preservation measure, not a penalty, and it is time-bounded by internal review deadlines rather than left open indefinitely. Cases are reviewed on a defined cycle and either escalated, extended with a recorded justification, or released.\", \"You can contest a freeze through /contact and you can ask for a case to be reviewed by someone who was not involved in the original decision. Where the outcome clears you, the hold is released, any reversed Points or commission are restored, and the case record notes the clearance.\"], \"heading\": \"10. Account freezing and investigation powers\"}, {\"body\": [\"KYC records — documents, extracted data, verification decisions, screening results — and transaction records are retained for approximately five years from the end of the member relationship or from the date of the transaction, as the applicable regulation requires, and longer where an authority directs. Case files, alerts, analyst rationales and reports are retained on the same basis.\", \"Access to identity documents and verification records is restricted to the Compliance role. It is not available to support agents, marketing, engineering or general administrators. Every access is written to an immutable log recording who read what, when and under which case reference, and those logs are reviewed for access without a matching case.\", \"Documents are encrypted at rest with AES-256 in a store segregated from the application database, are never exported to a spreadsheet or a shared drive, and are deleted or irreversibly anonymised when the retention period ends. Backup rotation means deletion completes over a defined window rather than instantly.\"], \"heading\": \"11. Record keeping and access control\"}, {\"body\": [\"A named Compliance Officer is designated with responsibility for this policy, for the risk assessment behind it, for reporting decisions and for reporting to the board. The name and contact route are inserted before publication, and the role has the authority to freeze funds and block payouts without commercial override.\", \"All staff complete AML and fraud-awareness training on joining and at least annually, with role-specific modules for support, finance and compliance. Support agents are trained to recognise and escalate red flags rather than resolve them, and to avoid tipping off.\", \"The policy, the risk assessment, the monitoring rules and their calibration are reviewed at least annually and after any material change to the product, the payout mechanics or the law, with independent testing of control effectiveness. Reviews and their findings are documented.\"], \"heading\": \"12. Compliance Officer, staff training and audit\"}, {\"body\": [\"This AML / KYC Policy is a structural draft. It was written to define the required content, sections and clauses for the development and legal teams, and it is not ready-to-publish legal text.\", \"A licensed attorney in each operating jurisdiction must review, adapt and approve the final language before publication. Requirements differ significantly by country and by state, and they differ again depending on whether the platform is classified locally as gaming, gambling, e-commerce or a financial service.\", \"Nothing in this document is legal, tax or financial advice, and nothing in it creates a relationship of adviser and client between you and Members Trail. If you need advice about how this document applies to your own circumstances, consult a qualified professional in your jurisdiction.\", \"Questions about this policy, including data-subject requests and compliance enquiries, should go to the compliance team through /contact rather than to general support.\"], \"heading\": \"Draft status and legal notice\"}]',0,'2026-09-01 00:00:00.000000',NULL,'ef59688c-7ab0-4bc8-8f92-0a59cd725e43',NULL),('52b10f3a-b5bb-4d2a-8e43-3da6089d52e4','2026-08-24 08:21:04.662446','2026-08-24 08:21:04.662446','privacy','Privacy Policy','1.0','legal_review','We collect what the service needs and what the law makes us keep: account details, gameplay and transaction records, identity documents and a liveness selfie for verification, and a device fingerprint used to detect fraud and multi-accounting. Identity documents are encrypted at rest, visible only to the compliance team, and every access is logged. You can ask for a copy of your data, correct it, port it or have it deleted — except where AML law requires us to keep verification records for about five years. We do not sell personal data.','[{\"body\": [\"The Members Trail operating entity is the data controller for the personal data described in this policy. Its registered name, address and company number will be inserted before publication, and must be the entity that contracts with members in your region.\", \"Where our processing volume or the sensitivity of the data we handle requires it, a Data Protection Officer is appointed and contactable through the compliance route at /contact. Data-subject requests are handled by the compliance team, not general support, so that they are logged, tracked against a statutory deadline and answered by people trained to verify who is asking.\", \"For members in the EU, EEA or UK, and in other regions with an equivalent regime, we act as controller for account and compliance data and as controller jointly with our verification provider for the identity checks that provider performs on our instructions. The final text will name the provider and the exact allocation of responsibilities.\"], \"heading\": \"1. Who controls your data\"}, {\"body\": [\"Account and profile data: your email address, hashed password, display name, avatar, declared country of residence, date of birth, notification preferences and language. Contact data if you give it to us, including a phone number used for two-factor authentication and account-recovery checks.\", \"Identity and verification data: the government identity document you upload, the data extracted from it, a liveness selfie and the biometric template our provider derives from it to confirm the selfie matches the document and is a live person. For Tier 2 verification, a proof-of-address document and, where required, evidence of your source of funds. This is the most sensitive category we hold and it is treated accordingly.\", \"Financial and transaction data: deposits, in-app purchases, tournament entries, marketplace activity, Points issuance and conversion, staking positions and rewards, referral commission line items with the Treasury deposit reference that funded each one, withdrawals, and the wallet addresses you connect or withdraw to. Payment card numbers are handled by our payment processor and are never stored on our systems.\", \"Device, usage and fraud-prevention data: IP address, approximate location derived from it, browser and device characteristics combined into a device fingerprint, session times, pages viewed, in-game events, and the relationship graph of who referred whom. The fingerprint exists for a specific purpose — detecting multi-accounting, self-referral and referral-loop fraud — and is described here because using it for that is a legitimate interest you are entitled to know about.\"], \"heading\": \"2. What we collect\"}, {\"body\": [\"To perform our contract with you: creating and securing your account, running games and tournaments, issuing and converting Points, executing staking actions, calculating and paying commission, and processing deposits and withdrawals. Without this data there is no service to provide.\", \"To comply with a legal obligation: identity verification, sanctions and politically-exposed-person screening, transaction monitoring, suspicious activity reporting, record retention and tax reporting where it applies. This basis is why some data cannot be deleted on request while the retention period runs.\", \"For our legitimate interests: preventing fraud, abuse and multi-accounting; enforcing caps and daily limits; protecting the integrity of leaderboards and prize pools; securing the platform; and understanding aggregate product usage. We balance these interests against your rights, and we use the least intrusive method that works — for example, a device fingerprint used to link duplicate accounts rather than continuous location tracking.\", \"With your consent: marketing emails and push notifications, non-essential analytics and any optional personalisation. Consent is asked for separately, is never bundled into acceptance of the Terms, and can be withdrawn at any time in your notification settings or through the cookie preference centre. Withdrawing it does not affect processing that already happened on a different basis.\"], \"heading\": \"3. Why we process it, and on what legal basis\"}, {\"body\": [\"Identity verification provider: receives your identity document, selfie and the data needed to run document authentication, liveness and screening checks, and returns a decision and an audit record. Payment processor: receives the data needed to take a payment, run its own fraud checks and process refunds and chargebacks. Cloud infrastructure and database hosting: stores the platform data under a processing agreement. Analytics and error monitoring: receives usage and diagnostic events, minimised and pseudonymised where the tool allows.\", \"Each processor is engaged under a written data-processing agreement that restricts it to processing on our instructions, requires appropriate security, restricts onward transfers and requires deletion or return of data at the end of the engagement. The final text will name each provider and its role, and that list will be kept current in the CMS rather than frozen in a PDF.\", \"We also disclose data where the law requires it: to a regulator, a financial intelligence unit, a tax authority, a court order or a lawful law-enforcement request. We disclose the minimum the request compels, and we log each disclosure. In a merger or acquisition, data may transfer to the successor entity, which remains bound by this policy until members are notified of any change.\", \"We do not sell personal data, we do not share it with data brokers, and we do not use identity or KYC data for advertising. Referral relationships are visible to your upline only as an aggregate and a masked identifier, never as another member\'s email address, document data or full name.\"], \"heading\": \"4. Who we share it with\"}, {\"body\": [\"Our infrastructure and some of our processors operate outside the country where you live, so your data may be transferred across borders. Where it leaves a jurisdiction that restricts transfers, we rely on an approved mechanism: an adequacy decision where one covers the destination, Standard Contractual Clauses or the UK International Data Transfer Addendum otherwise, backed by a transfer impact assessment.\", \"Where the assessment identifies a risk in the destination country, we add supplementary measures — encryption in transit and at rest with keys held in the origin region, pseudonymisation before transfer, and contractual commitments to challenge unlawful access requests and to notify us of any we are permitted to be told about.\", \"You can ask us for a summary of the transfer mechanism that applies to your data and the categories of recipient outside your region. We will provide it in a form that does not expose security detail an attacker could use.\"], \"heading\": \"5. International transfers\"}, {\"body\": [\"Account and profile data: for the life of your account and then for a limited wind-down period after closure to handle disputes, chargebacks and reversal windows, expected to be twelve months, before deletion or irreversible anonymisation.\", \"KYC and AML records, including identity documents, verification decisions, screening results, transaction monitoring alerts and suspicious activity reports: retained for approximately five years from the end of the relationship or from the date of the transaction, whichever the applicable regulation requires, and longer where an authority directs it. This retention overrides an erasure request for those specific records.\", \"Transaction and financial records: retained for the statutory accounting and tax period in the relevant jurisdiction. Gameplay and Points ledger data: retained while it can affect a balance, a dispute or a leaderboard, then aggregated. Support tickets: retained for the period needed to show a complaint was handled, then closed and minimised. Device and analytics data: retained for a short rolling window described in the Cookie Policy, and fraud-signal records for as long as an investigation or an appeal against a fraud decision can be brought.\", \"When a retention period ends the data is deleted or anonymised so it can no longer be linked to you. Backups roll off on their own cycle, which means deletion is completed rather than instantaneous, and we will tell you the expected completion window when you ask.\"], \"heading\": \"6. How long we keep it\"}, {\"body\": [\"Subject to the regime that applies where you live, you can: get confirmation of whether we process your data and a copy of it; have inaccurate data corrected; have data erased where we no longer have a basis to keep it; get a portable machine-readable export of the data you gave us and the data your activity generated; restrict processing while a dispute about accuracy or basis is resolved; object to processing based on legitimate interests; and withdraw consent for marketing and non-essential analytics at any time.\", \"Erasure has a real limit and we would rather state it here than surprise you later. Where AML law requires us to keep a verification record, we cannot delete that record on request during the retention period. We will delete or restrict everything that is not caught by that obligation, tell you precisely which categories are being retained and why, and delete those categories when the period ends.\", \"To exercise a right, use the compliance route at /contact. We will verify that the request comes from you — which for an identity-linked request may mean checking against the verification already on file — and answer within the statutory period, normally one month, extendable where a request is complex. We do not charge for a first request and we do not require you to give a reason.\", \"You also have the right to complain to your data protection supervisory authority, and to do so without contacting us first. We would prefer you raise it with us so we can fix it, but that is a preference, not a condition.\"], \"heading\": \"7. Your rights\"}, {\"body\": [\"Data at rest is encrypted with AES-256, and identity documents and selfies are stored in a segregated encrypted store separate from the application database. Data in transit is encrypted with current TLS. Passwords are stored only as salted hashes using a memory-hard algorithm, and we never see or store them in plain text.\", \"Access is role-based and least-privilege. Identity documents and verification decisions are visible only to the Compliance role, and every read is written to an immutable access log with the operator, the record and the reason code. Administrative actions that touch money — adjusting a balance, releasing a commission, freezing an account — require a second approver and are recorded in the audit log.\", \"Around that we run two-factor authentication for staff, secrets held in a managed key store, vulnerability scanning and dependency monitoring, environment separation with no production data in test environments, backups that are themselves encrypted, and an incident response plan with defined severity levels.\", \"No system is invulnerable. If a breach is likely to result in a risk to your rights and freedoms we will notify the relevant authority within the statutory window, normally 72 hours, and notify you without undue delay with a description of what happened, what data was involved and what you should do. We describe our controls at this level deliberately: enough for you to judge them, not enough to give an attacker a map.\"], \"heading\": \"8. How we protect it\"}, {\"body\": [\"We use cookies and local storage for session management, security, remembering your preferences, and — with your consent — analytics and product measurement. Some of the same signals feed the fraud-prevention systems described above.\", \"The full categorised list, the duration of each group, which are first and which are third party, and how to change your choices are in the Cookie Policy. Your consent choices are recorded with a timestamp so we can show what you agreed to and when.\"], \"heading\": \"9. Cookies and similar technologies\"}, {\"body\": [\"The platform is not directed at children and we do not knowingly collect data from anyone under 18, or under a higher local minimum age where one applies. Age is declared at registration and confirmed against the date of birth on the identity document at verification, which is the point at which a false declaration is normally caught.\", \"If we discover that an account belongs to a person under the applicable age we close it immediately, stop processing beyond what we need to document the closure, delete the data we are not required to retain, and return any recoverable payment to the source it came from. We do not pay out winnings, staking rewards or referral commission to an underage account.\", \"If you believe a child is using the platform, tell us through /contact. Reports of underage use are treated as urgent and are handled by the compliance team.\"], \"heading\": \"10. Children\'s privacy\"}, {\"body\": [\"This policy is versioned in the CMS with a full history. Clarifications take effect on publication. A change that materially affects how we use your data, who we share it with, or how long we keep it is notified in advance by email and in-product, and where a new purpose relies on consent we ask for that consent separately rather than inferring it from continued use.\", \"The version number and effective date at the top of this page always identify the text currently in force, and previous versions remain available on request.\"], \"heading\": \"11. Changes to this policy\"}, {\"body\": [\"Data-subject requests, privacy questions and complaints: use the compliance category at /contact. If a DPO has been appointed, that route reaches them directly.\", \"If you are unhappy with our response you can complain to the supervisory authority in your country of residence, or where the operating entity is established. Exercising that right costs you nothing and does not affect your account.\"], \"heading\": \"12. Contact and complaints\"}, {\"body\": [\"This Privacy Policy is a structural draft. It was written to define the required content, sections and clauses for the development and legal teams, and it is not ready-to-publish legal text.\", \"A licensed attorney in each operating jurisdiction must review, adapt and approve the final language before publication. Requirements differ significantly by country and by state, and they differ again depending on whether the platform is classified locally as gaming, gambling, e-commerce or a financial service.\", \"Nothing in this document is legal, tax or financial advice, and nothing in it creates a relationship of adviser and client between you and Members Trail. If you need advice about how this document applies to your own circumstances, consult a qualified professional in your jurisdiction.\", \"Questions about this policy, including data-subject requests and compliance enquiries, should go to the compliance team through /contact rather than to general support.\"], \"heading\": \"Draft status and legal notice\"}]',0,'2026-09-01 00:00:00.000000',NULL,'ef59688c-7ab0-4bc8-8f92-0a59cd725e43',NULL),('569f2444-6ffe-4bda-bb66-8cc578f4c589','2026-08-24 08:21:04.692799','2026-08-24 08:21:04.692799','cookies','Cookie Policy','1.0','legal_review','We use four kinds of cookie: the ones the site cannot work without, the ones that remember your preferences, the ones that measure how the product is used, and the ones that detect fraud and multi-accounting. Analytics is the only category that waits for your consent — you can refuse it and everything still works. Fraud-prevention cookies run without consent because we rely on them to protect accounts and enforce the referral rules, and we would rather say so than hide them in a necessary bucket.','[{\"body\": [\"A cookie is a small file a site stores in your browser and reads on later requests. We also use closely related technologies — local storage, session storage and pixels — and everything in this policy applies to those too, because the distinction matters to engineers and not to your privacy.\", \"We use them for four things: keeping you securely logged in and protecting requests; remembering choices such as theme, language and which referral link you arrived through; measuring how the product is used in aggregate; and detecting fraud, in particular the duplicate accounts and referral loops that the programme rules prohibit.\", \"We do not use advertising or cross-site tracking cookies, we do not run retargeting pixels, and we do not sell or share cookie data with data brokers or ad networks. If that changes, this policy will be updated and consent will be asked for before any such cookie is set.\"], \"heading\": \"1. What cookies are and why we use them\"}, {\"body\": [\"Strictly necessary. Session, security, CSRF protection, edge bot management and the record of your own cookie choices. Without these the platform cannot authenticate you or protect your account, so they are set on every visit and cannot be switched off. Refusing them means not using the platform.\", \"Functional. Preferences that make the interface behave the way you left it: theme, language, last wallet used, and the referral attribution cookie that credits the right member when you sign up. Turning these off does not break anything; it just makes the product forget you.\", \"Analytics. Aggregate measurement of how features are used, plus error and performance monitoring. This category is optional and is only set after you consent. Refusing it costs you nothing functionally — the effect is on our ability to see which parts of the product are working.\", \"Fraud prevention. A device identifier and fingerprint signals used to link duplicate accounts, detect account takeover and enforce the referral programme\'s self-referral and loop rules, plus a risk cookie set by the payment processor at checkout. These are set without consent because we rely on them to protect members\' funds and to meet our AML obligations. We list them as their own category rather than folding them into strictly necessary, because you are entitled to know they exist and what they do.\"], \"heading\": \"2. The four categories\"}, {\"body\": [\"The table below lists each cookie or cookie group, its purpose, how long it lasts, whether it is set by us or by a third party, and whether it waits for your consent. Names of third-party groups are described by function here; the final text will name each provider once the vendor contracts are signed.\", \"Durations are maximums. A session cookie is deleted when you close the browser, and a cookie whose purpose has ended — an expired referral attribution, for instance — is cleared before its stated maximum.\"], \"heading\": \"3. Cookie categories table\"}, {\"body\": [\"On your first visit a consent banner asks for your choice. Accepting all sets every category. Rejecting non-essential sets only the strictly necessary, functional and fraud-prevention categories. Choosing manage lets you decide category by category. The banner does not use a pre-ticked box for analytics, and rejecting is one click, not a hunt through a submenu.\", \"You can change your mind at any time from the cookie preference centre in your account settings or from the link in the site footer. A change applies immediately: withdrawing analytics consent stops further collection and clears the analytics cookies we control on your next request. It does not retroactively delete data already collected, though you can ask for that separately through the data rights process in the Privacy Policy.\", \"Your choice, and the timestamp of it, is recorded in the consent cookie and on our side, so we can show what you agreed to and when. Consent is asked for again after 12 months, or sooner if we add a category or change a purpose materially.\"], \"heading\": \"4. Managing your preferences\"}, {\"body\": [\"Every major browser lets you view and delete cookies, block third-party cookies, block all cookies for a site, and clear storage on exit. Those controls sit above ours: if you block cookies at the browser level, our preference centre cannot override that.\", \"Blocking strictly necessary cookies will break sign-in, and blocking storage entirely will prevent the platform from keeping you authenticated between requests. Clearing cookies will also clear your consent record, which is why the banner reappears afterwards, and will clear the referral attribution cookie, which is why a referral link should be used in the same browser you sign up in.\", \"We honour Global Privacy Control where your browser sends it, treating it as a refusal of the optional analytics category. We do not currently treat the older Do Not Track header as a valid signal, because it has no agreed meaning; if that changes we will say so here.\"], \"heading\": \"5. Browser and device controls\"}, {\"body\": [\"Third parties that may set cookies through the platform are our edge and bot-protection provider, our product analytics provider, our error and performance monitoring provider, our payment processor at checkout, and our identity verification provider during a verification session.\", \"Each is engaged under a data-processing agreement that limits it to processing on our instructions and prohibits using platform data for its own advertising. We do not embed social media, advertising or video-hosting scripts that set tracking cookies on our pages.\", \"These providers have their own privacy notices, and the final text of this policy will link to each. Where a provider sets a cookie in a category that requires consent, it is not loaded at all until you consent — the script is withheld, not merely told to behave.\"], \"heading\": \"6. Third-party cookies\"}, {\"body\": [\"This policy explains the storage mechanism. The Privacy Policy explains what we do with the data it produces: the legal basis for each purpose, how long we keep it, who it is shared with, whether it leaves your region, and the rights you can exercise over it.\", \"Two points connect the two documents directly. First, the fraud-prevention category feeds the device fingerprint described in the Privacy Policy, relied on as a legitimate interest for detecting multi-accounting and referral fraud. Second, analytics data is pseudonymous and is never joined to your identity or KYC records, which are held in a segregated encrypted store restricted to the compliance team.\"], \"heading\": \"7. Relationship to the Privacy Policy\"}, {\"body\": [\"We update this policy when we add, remove or change a cookie or a provider. The version number and effective date at the top of the page identify the text in force, and the version history is kept in the CMS.\", \"A new category, a new purpose or a new third party that requires consent triggers a fresh consent request rather than a silent update. Adding a strictly necessary cookie, or removing one, is published here without a new request.\"], \"heading\": \"8. Updates to this policy\"}, {\"body\": [\"This Cookie Policy is a structural draft. It was written to define the required content, sections and clauses for the development and legal teams, and it is not ready-to-publish legal text.\", \"A licensed attorney in each operating jurisdiction must review, adapt and approve the final language before publication. Requirements differ significantly by country and by state, and they differ again depending on whether the platform is classified locally as gaming, gambling, e-commerce or a financial service.\", \"Nothing in this document is legal, tax or financial advice, and nothing in it creates a relationship of adviser and client between you and Members Trail. If you need advice about how this document applies to your own circumstances, consult a qualified professional in your jurisdiction.\", \"Questions about this policy, including data-subject requests and compliance enquiries, should go to the compliance team through /contact rather than to general support.\"], \"heading\": \"Draft status and legal notice\"}]',0,'2026-09-01 00:00:00.000000',NULL,'ef59688c-7ab0-4bc8-8f92-0a59cd725e43',NULL),('594e6869-6919-4f01-a70e-acb6e6302168','2026-08-24 08:21:04.667781','2026-08-24 08:21:04.667781','risk-disclosure','Risk Disclosure Statement','1.0','legal_review','Read this one even if you skip the others. You can lose money here. MTT may fall to zero and may never be tradable, staking rewards are variable and can be nothing at all in a low-revenue period, the smart contracts have not yet completed an independent audit, and there is no deposit insurance behind any balance. Referral commission is capped and most participants earn little or nothing — treat it as an occasional bonus, never as income you plan around.','[{\"body\": [\"This statement exists to tell you plainly what can go wrong. It is not a formality and it is not balanced against a sales pitch. If any part of it describes an outcome you could not absorb, do not deposit, do not convert Points to MTT, and do not stake.\", \"The short version: money you put into this platform can be lost in full. Points you earn may be worth less when you convert them than you expected. MTT you hold may lose all of its value. Rewards you expect may not arrive because the revenue that funds them did not arrive. None of these outcomes are hypothetical edge cases; they are ordinary possibilities of the design.\", \"You can use Members Trail without exposure to most of what follows. Playing games and earning Points costs nothing. The risks described here attach to spending real money, holding MTT, staking and relying on commission.\"], \"heading\": \"1. Read this before you spend anything\"}, {\"body\": [\"MTT is a utility token. If and when it becomes tradable on any venue, its market price will be set by that market and not by us. It may move sharply in either direction within a single day, it may fall far below the effective rate at which you converted Points, and it may fall to zero and stay there.\", \"We do not operate a price floor, we do not commit to buying MTT back, we do not maintain a peg, and nothing in the platform\'s design prevents the price falling. A conversion rate shown in the app is a platform accounting rate for converting Points; it is not a market price, not a valuation, and not a promise about either.\", \"If a market exists, thin liquidity can make the price move violently on small volume. A price you see quoted is not a price you are guaranteed to get.\"], \"heading\": \"2. MTT price volatility\"}, {\"body\": [\"No page, chart, projection, calculator, notification, tooltip, blog post or message from our team is financial, investment, legal or tax advice, and none of it is a recommendation to buy, hold, stake or sell anything. The referral calculator is an arithmetic tool that computes a scenario you typed in; it is not a forecast and it has no predictive value.\", \"MTT is intended for participation in the platform. It is not an investment product, not a security offering as we understand it in the jurisdictions where we intend to operate, not a deposit and not a fund. Holding it gives you no ownership of the company, no share of profit, no dividend and no governance right.\", \"If you are trying to decide whether participating makes financial sense for you, take advice from a licensed professional in your own jurisdiction. We are not that professional and we have an obvious interest in your participation.\"], \"heading\": \"3. Nothing here is investment advice\"}, {\"body\": [\"Every staking reward is funded from the Revenue Treasury, which is filled by real platform revenue — in-app purchases, tournament entries, marketplace fees and subscriptions. The reward rate you see is a variable rate recalculated from the inflows of the relevant period. It is not an APR you have been promised.\", \"The direct consequence: if revenue falls, rewards fall. If revenue in a period is very low, the reward for that period can be near zero. There is no reserve obligation, no top-up guarantee and no smoothing mechanism that pays you a rate the business did not earn. Any historical figure shown in the app is history, and history is not a forecast.\", \"Locking also has a cost. During a lock period your principal is unavailable, so you cannot react to a falling token price by exiting. Where early unstaking is permitted, the published penalty applies and can consume all accrued reward and part of the principal. Read the pool terms before you commit, not after.\"], \"heading\": \"4. Staking rewards are variable, and can be nothing\"}, {\"body\": [\"It is entirely possible to play, spend money, refer people and stake, and end up with nothing to show for it. There is no floor under your outcome. Points caps limit what gameplay can produce, tournaments have losers, staking rewards can be negligible, and referral commission depends on other people choosing to spend money, which they may never do.\", \"We publish no target earnings, no average earnings and no example of what you can expect to make, because any such figure would be misleading. Where we show a number it is either your own historical figure or a platform-wide aggregate, and neither predicts your future.\", \"Assume, when deciding what to spend, that your recoverable return is zero. If that assumption changes your decision, the decision was being made on an expectation we have never offered.\"], \"heading\": \"5. You may earn nothing\"}, {\"body\": [\"Staking, commission claims and token transfers execute in smart contracts on the BNB Smart Chain. Smart contracts are software. They can contain bugs, they can be exploited by attackers, they can be locked by a failed upgrade, and they can lose funds in ways that cannot be reversed because the network has no undo.\", \"An independent third-party security audit of our contracts is planned but not yet complete, and no audit report has been published. Until one is, you are interacting with unaudited code. Even after an audit is published, an audit is a point-in-time review by fallible humans; it reduces risk and does not remove it. Audited contracts have been drained before.\", \"Contracts are deployed to testnet before mainnet and administrative functions are held behind a multi-signature wallet, which limits some failure modes and creates others — a multisig with lost or compromised signers is its own risk. Treat any amount held in a contract as an amount you could lose entirely and without recourse.\"], \"heading\": \"6. Smart contract risk, and the audit is not finished\"}, {\"body\": [\"The rules that govern skill-based gaming, token rewards and multi-level referral programmes are unsettled and are changing in most of the markets we care about. A law, a regulation, a regulator\'s guidance or a court decision could reclassify part of the platform, restrict it, tax it differently, or make it unlawful to offer in your country.\", \"If that happens we may have to disable features, stop issuing Points, suspend the referral programme, block a jurisdiction, or cease operating there entirely, potentially at short notice. A reclassification of MTT as a regulated instrument in a given country could restrict your ability to hold, transfer or convert it there.\", \"We will give as much notice as the circumstances and the regulator allow, and will make reasonable efforts to let you withdraw a verified balance. We cannot promise a withdrawal window that a legal order forecloses.\"], \"heading\": \"7. Regulatory and jurisdictional risk\"}, {\"body\": [\"There may be no active market for MTT at all. We have not committed to listing it on any exchange or decentralised venue, and a listing, if it ever happens, is subject to third-party decisions and securities analysis in the relevant jurisdictions.\", \"Without a market, MTT is usable inside the platform and not convertible to cash anywhere. With a thin market, you may be unable to sell the size you hold at anything close to the quoted price, and you may be unable to sell at all when you most want to.\", \"Withdrawal itself depends on things outside our control: network congestion, gas costs that can exceed the value of a small withdrawal, and the availability of the payment or custody providers in the chain. A withdrawal can be delayed by verification, by the new-address cooling-off period, or by a compliance hold.\"], \"heading\": \"8. Liquidity risk\"}, {\"body\": [\"Referral commission is a marketing payment, not an investment return and not income you should plan around. It pays 8%, 3% and 1% across three levels, calculated only on eligible real-money spend by the members in those levels — never on their deposits, never on their stake principal, never on the size of their downline.\", \"It is capped every month at the lower of an absolute ceiling and a formula tied to your own recent spend, so the amount you can receive is bounded no matter how large your network is. Caps do not roll over: an unused cap expires with the month. Payment also depends on the Treasury having received the revenue in the first place, and can be delayed or reduced if it has not.\", \"The realistic distribution is heavily skewed. A small number of participants with large, genuine networks earn a meaningful amount; most earn a small amount or nothing at all. If someone tells you this programme is a route to a predictable income, they are breaching our marketing rules and you should not believe them. Referring is optional, free, and never required in order to play, earn or withdraw.\"], \"heading\": \"9. Referral income is capped and usually small\"}, {\"body\": [\"If you connect a self-custodied wallet, you alone hold the keys. We cannot recover a lost seed phrase, reverse a transaction you signed, unwind a transfer to a wrong address, or retrieve tokens sent on the wrong network. Those losses are permanent.\", \"Phishing is the most common way people lose funds here. We will never ask for your seed phrase or private key, never ask you to sign a transaction sent to you in a message, and never contact you first asking you to move funds to safety. Treat any message that does as an attack.\", \"If a custodial wallet option is offered, keys are held by a provider under a custody arrangement, which replaces your key-loss risk with counterparty risk in that provider, and adds insolvency and operational risk. Custody is itself a regulated activity in many jurisdictions and the arrangement is subject to separate legal review.\"], \"heading\": \"10. Wallet and custody risk\"}, {\"body\": [\"Balances on Members Trail are not bank deposits. They are not covered by deposit insurance, by an investor compensation scheme, or by any government guarantee, in any jurisdiction. If the company becomes insolvent, your balance is a claim in that insolvency and may be worth a fraction of its stated value, or nothing.\", \"The Revenue Treasury is an operational pool funded by platform revenue, not a segregated client-money account and not a reserve fund held for your benefit. Do not treat it as a backstop for the value of your balance.\"], \"heading\": \"11. No deposit insurance and no protection scheme\"}, {\"body\": [\"We may change, suspend or discontinue any part of the platform: retire a game, close a staking pool, alter Points issuance prospectively, change the conversion rate, adjust or end the referral programme, or shut the service down. Business, technical and regulatory reasons all lead there.\", \"Where a change affects a balance or an accrued entitlement, we will give notice and, where feasible, a window to convert, unstake or withdraw. We cannot promise that in every scenario, and a scenario driven by a regulator or a security incident may not allow it.\", \"You acknowledge that you have read this statement, that you understand it, and that you accept these risks as a condition of using the paid and token features of the platform.\"], \"heading\": \"12. No guarantee of continued operation\"}, {\"body\": [\"This Risk Disclosure Statement is a structural draft. It was written to define the required content, sections and clauses for the development and legal teams, and it is not ready-to-publish legal text.\", \"A licensed attorney in each operating jurisdiction must review, adapt and approve the final language before publication. Requirements differ significantly by country and by state, and they differ again depending on whether the platform is classified locally as gaming, gambling, e-commerce or a financial service.\", \"Nothing in this document is legal, tax or financial advice, and nothing in it creates a relationship of adviser and client between you and Members Trail. If you need advice about how this document applies to your own circumstances, consult a qualified professional in your jurisdiction.\", \"Questions about this policy, including data-subject requests and compliance enquiries, should go to the compliance team through /contact rather than to general support.\"], \"heading\": \"Draft status and legal notice\"}]',1,'2026-09-01 00:00:00.000000',NULL,'ef59688c-7ab0-4bc8-8f92-0a59cd725e43',NULL),('752d98cb-541c-403a-af9c-4195035e7213','2026-08-24 08:21:04.682446','2026-08-24 08:21:04.682446','refunds','Refund & Cancellation Policy','1.0','legal_review','Digital items are refundable while they are unused, and not once they have been consumed in play — a spent boost cannot be returned. If we cancel a tournament, entries are refunded in full; if you withdraw voluntarily after it starts, they are not. Technical errors like double charges are always put right. Token conversions and on-chain transactions are irreversible. Filing a chargeback instead of contacting us suspends the account and claws back the commission your purchase generated for your upline.','[{\"body\": [\"This policy covers in-app purchases, tournament entries, marketplace purchases, subscriptions, failed transactions and token conversions. It sits under your statutory consumer rights, which it cannot reduce: where the law where you live gives you a stronger right than this policy, the law applies.\", \"The principle is simple. If we took your money and did not deliver what you paid for, you get it back. If you received and used what you paid for, you generally do not. Between those two cases sits a small band of judgement, and in that band we would rather resolve a genuine complaint than win an argument.\", \"All refunds are returned to the original payment method. We do not refund to a different card, a different bank account or a crypto address, because doing so is a well-known laundering route and our AML obligations do not permit it.\"], \"heading\": \"1. Scope and the principle behind it\"}, {\"body\": [\"Digital items — Points packs, boosts, cosmetics, entry tickets, consumables — are delivered to your account immediately on payment. An item that is unused and still in your inventory can be refunded within 14 days of purchase on request. An item that has been consumed in play cannot be refunded, because what you bought has been provided and cannot be returned.\", \"Where a statutory cooling-off right applies to digital content in your jurisdiction, it applies here. In several regimes that right is lost once you begin using the content and you have acknowledged that at checkout; where the right survives, we honour it regardless of what this policy says.\", \"Purchases made through a mobile app store are subject to that store\'s refund process as well as ours. Where the store issues the refund, the corresponding item is removed from your account and any commission the purchase generated is clawed back from the upline.\", \"A pattern of buy-use-refund requests is treated as abuse. We may decline further discretionary refunds on an account with such a pattern and, where it looks deliberate, escalate it under the AML/KYC Policy.\"], \"heading\": \"2. In-app purchases and digital goods\"}, {\"body\": [\"If we cancel a tournament before it starts, every entry fee is refunded in full to the original payment method or credited back as the same asset it was paid with, and no platform fee is retained. If we cancel a tournament after it has started — for a technical failure, a suspected integrity problem or a force majeure event — entries are refunded in full and no prizes are paid, unless the tournament rules provide for a partial-standings settlement, in which case the published rules govern.\", \"If you withdraw voluntarily from a tournament you have entered, the entry fee is not refunded once entries have closed or play has begun. Before entries close, a voluntary withdrawal is refunded less any published administration fee. The cut-off is stated on each tournament card before you enter.\", \"If a tournament is voided because of confirmed cheating, collusion or bot use, the implicated entrants forfeit their entries and any winnings, and the honest entrants are refunded in full. Prize pools funded by the platform are not paid out on a voided tournament, and prize pools funded by entries are returned to the honest entrants pro rata.\", \"A prize already credited can be reversed if it is later found to result from cheating, an exploit or a scoring error. Reversals appear in your transaction history with the reason and are disputable through support.\"], \"heading\": \"3. Tournament entries and prize pools\"}, {\"body\": [\"A double charge, a payment taken with nothing delivered, an item not credited, a Points pack not applied, or a duplicate subscription charge is a platform error and is corrected in full — normally by refunding the erroneous charge, or by delivering what you paid for if you would rather have that.\", \"Report it through /contact with the transaction reference. We acknowledge within one business day, and errors that are visible in our own ledger are typically resolved within 3 to 5 business days. Cases that need the payment provider to confirm can take up to 10 business days, and we will tell you if yours is one of them.\", \"Where our error caused you a knock-on loss — you missed a tournament because the entry ticket did not arrive — we will make it good with a credit or a re-entry in a comparable event. That remedy is discretionary and does not extend our liability beyond what the Terms allow.\"], \"heading\": \"4. Failed and erroneous transactions\"}, {\"body\": [\"Converting Points to MTT is executed at the rate shown at the moment you confirm, and it is not reversible. There is no refund of converted MTT back to Points, and no re-conversion at a historical rate if the rate moves afterwards. The confirmation screen shows the rate, the fee and the amount you will receive before you commit, and you must accept it to proceed.\", \"On-chain actions — a withdrawal to an external address, a stake, an unstake, a commission claim — settle on the blockchain and cannot be reversed by us once broadcast. A transaction sent to a wrong address you supplied, or on the wrong network, is not recoverable and is not refundable. Check the address and the network before you sign.\", \"Gas fees are paid to the network, not to us, and are not refundable even where a transaction fails on-chain. If a platform bug caused a failed transaction, we will cover the wasted gas as a credit once we have verified the failure from the transaction hash.\", \"Where a withdrawal is rejected by compliance before broadcast, the amount returns to your platform balance in full and the processing fee is not charged.\"], \"heading\": \"5. Token conversions and on-chain transactions\"}, {\"body\": [\"Subscriptions renew automatically until you cancel. You can cancel at any time from your settings, and cancellation stops the next renewal; it does not end the period you have already paid for, and your benefits continue to the end of that period.\", \"We do not refund a partial period, and we do not refund a renewal you forgot to cancel where the benefits of that period were available to you — except where consumer law in your jurisdiction requires otherwise, or where you cancel within a statutory cooling-off window and have not used the period\'s benefits.\", \"If we materially reduce the benefits of a subscription tier mid-period, you may cancel and receive a pro-rata refund of the unused part. Price increases apply only from the next renewal after notice, never mid-period.\"], \"heading\": \"6. Subscriptions\"}, {\"body\": [\"If you believe a charge is wrong, contact us first. A chargeback is a dispute filed with your bank or card issuer against us; it costs us a scheme fee, it takes weeks, and it produces a worse outcome for you than a support ticket that we can usually settle in days.\", \"When a chargeback is filed we suspend the account pending resolution, freeze withdrawals and pause commission release. Items and Points delivered by the disputed purchase are removed. If the chargeback is upheld, the account may stay closed and any balance derived from the disputed purchase is forfeited.\", \"Commission is clawed back too. A chargeback removes the level 1, level 2 and level 3 commissions that the purchase generated, from every upline that received them. Where that commission has already been paid out, the clawback is recovered from those uplines\' future commission or, in a fraud case, from their withdrawable balance. Uplines see the reversal and its reason in their payout history and can dispute it, but the reversal itself follows automatically from the chargeback.\", \"A pattern of chargebacks, or a chargeback filed on a purchase whose benefit was consumed, is treated as payment fraud and is escalated under the AML/KYC Policy. It may be reported to the payment provider and to the relevant authority.\"], \"heading\": \"7. Chargebacks\"}, {\"body\": [\"So there is no ambiguity, the following are not refundable: Points already spent or converted; boosts, entries and consumables already used; MTT already converted from Points; on-chain gas fees; staking early-unstake penalties correctly applied under the pool terms; entry fees for tournaments you voluntarily left after entries closed; and subscription periods whose benefits were available to you.\", \"The following are always refundable: charges taken in error, duplicate charges, purchases where nothing was delivered, entries in tournaments we cancelled, and unused items within the 14-day window.\"], \"heading\": \"8. Non-refundable items, stated plainly\"}, {\"body\": [\"Open a ticket at /contact with the refund category, the transaction reference from your transaction history, the date, the amount and a short description of what went wrong. Screenshots help for anything visual.\", \"We acknowledge within one business day. A straightforward case is decided within 3 to 5 business days. A case needing the payment provider or a compliance review can take up to 10 business days, and we will tell you at the point we know. Once approved, the money leaves us immediately; how long it takes to appear depends on your bank or card issuer, typically 3 to 10 business days.\", \"If we decline, you get a written reason referencing the clause it rests on, and you can ask for a review by someone who was not involved in the first decision. Your statutory rights and your right to complain to a consumer protection body or a payment ombudsman are unaffected by our decision.\"], \"heading\": \"9. How to request a refund\"}, {\"body\": [\"This Refund & Cancellation Policy is a structural draft. It was written to define the required content, sections and clauses for the development and legal teams, and it is not ready-to-publish legal text.\", \"A licensed attorney in each operating jurisdiction must review, adapt and approve the final language before publication. Requirements differ significantly by country and by state, and they differ again depending on whether the platform is classified locally as gaming, gambling, e-commerce or a financial service.\", \"Nothing in this document is legal, tax or financial advice, and nothing in it creates a relationship of adviser and client between you and Members Trail. If you need advice about how this document applies to your own circumstances, consult a qualified professional in your jurisdiction.\", \"Questions about this policy, including data-subject requests and compliance enquiries, should go to the compliance team through /contact rather than to general support.\"], \"heading\": \"Draft status and legal notice\"}]',0,'2026-09-01 00:00:00.000000',NULL,'ef59688c-7ab0-4bc8-8f92-0a59cd725e43',NULL),('99f3684c-6294-4b72-a284-13ede3e2fbb4','2026-08-24 08:21:04.677238','2026-08-24 08:21:04.677238','referral-terms','Referral / Affiliate Program Terms','1.0','legal_review','Joining is free and there is no entry fee, pack or minimum spend — ever. You earn 8%, 3% and 1% on three levels, calculated only on eligible real-money spend by those members, never on their deposits, their stake principal or their token balances. Your monthly commission is capped at the lower of Rs 50,000 and five times your own trailing three-month spend plus a Rs 5,000 base, and an unused cap does not roll over. Commission is paid from real platform revenue, released after Tier 1 verification, and can be clawed back if the underlying transaction is refunded or found fraudulent.','[{\"body\": [\"The referral programme is a marketing arrangement. If someone joins Members Trail through your link and later spends real money on the platform, we pay you a percentage of that spend as a commission out of our own revenue. That is the whole mechanism.\", \"There are three levels. Level 1 is the people who joined directly through your link and pays 8%. Level 2 is the people who joined through their links and pays 3%. Level 3 is the next layer down and pays 1%. There is no level 4 and no deeper structure: maximum referral depth is three, and it is enforced in code, not by policy alone.\", \"The programme is not an investment scheme, not a business opportunity with projected returns, and not a job. It has no ranks to buy, no packages, no matrix, no binary tree, no matching bonus, no residual on your own spend and no payment for recruitment itself. You are paid only when real money is spent on real platform services by real verified members.\"], \"heading\": \"1. What the programme is\"}, {\"body\": [\"Joining the programme requires no payment. There is no entry fee, no starter pack, no activation purchase, no subscription, no minimum deposit and no minimum monthly spend required to join, to refer, to remain eligible, or to be paid commission you have properly earned.\", \"Nobody at Members Trail, and no other member, is permitted to ask you to pay for a position, a rank, a territory, a spillover placement or a training programme. If anyone asks you for money in exchange for referral upside, that is not part of this programme and you should report it through /contact immediately.\", \"You do not need to refer anyone to use the platform. Playing, earning Points, converting to MTT, staking and withdrawing all work identically for a member who never refers a single person. Referring is optional and stays optional.\"], \"heading\": \"2. No entry fee — ever\"}, {\"body\": [\"Commission is calculated only on eligible real-money spend: in-app purchases, tournament entry fees and subscription payments, net of tax, refunds and payment-processor fees. That spend is revenue to the platform, which is what makes paying a commission on it possible.\", \"The exclusions are as important as the inclusions and are absolute. There is no commission on a deposit — moving your own money onto the platform is not spend. There is no commission on stake principal, on the size of a downline\'s balance, on their Points balance, on their staking rewards, on their own commission, or on a token transfer. There is no commission on a purchase that is refunded or charged back, and none on a transaction we determine to be fraudulent, self-dealt or generated by automation.\", \"This distinction is the reason the programme is a marketing arrangement rather than a scheme funded by recruits\' money. Because commission is only ever a share of revenue, a downline that deposits and never spends produces no commission at all, and no amount of recruitment converts deposits into your earnings.\"], \"heading\": \"3. What spend is eligible, and what is excluded\"}, {\"body\": [\"Commissions are paid exclusively from the Revenue Treasury, which is funded by real platform revenue. No commission is ever funded from another member\'s deposit, from their staking principal, or from newly minted tokens issued to cover a shortfall.\", \"Each commission line item in your payout history carries the reference of the Treasury deposit that funded it, so the chain from a real revenue event to your payment is auditable by you and not just by us.\", \"The consequence is that commission depends on revenue actually arriving. If the Treasury has not received the revenue for a period — because a payment is still settling, because a transaction is in a refund window, or because revenue was lower than expected — commission for that period can be delayed, reduced or, in an extreme case, not paid. Commission is capped and revenue-funded, and it is not a guaranteed payment.\"], \"heading\": \"4. Funding source\"}, {\"body\": [\"To receive a payout you must hold an account in good standing, have completed Tier 1 identity verification, have held the account for at least 7 days, and have completed at least 5 genuine gameplay sessions before your first commission is released. The account-age and gameplay requirements exist to stop accounts created purely to sit at the top of a referral chain.\", \"Your commission in a calendar month is capped at the lower of two figures: an absolute ceiling of Rs 50,000, and a formula equal to five times your own eligible spend over the trailing three months plus a Rs 5,000 base. Worked example: with Rs 3,000 of your own eligible spend across the last three months, your formula cap is 5 x 3,000 + 5,000 = Rs 20,000 for the month, and Rs 20,000 is lower than the absolute ceiling, so Rs 20,000 is your cap.\", \"Commission calculated above your cap is not paid, is not carried forward and is not held in a pending balance. An unused cap does not roll over either — the cap resets at the start of each calendar month and the previous month\'s headroom expires with it. Cap usage is shown as a meter in your referral dashboard so you can see where you stand before the month closes, not after.\", \"The base component means a member who spends nothing themselves still has a real, if small, cap and is not shut out. The multiplier component means the programme cannot be turned into a pure recruitment income stream detached from participating in the platform.\"], \"heading\": \"5. Eligibility and the monthly cap\"}, {\"body\": [\"Self-referral is prohibited: you may not refer yourself, create a second account to sit in your own downline, or use a family member\'s or associate\'s account as a proxy for your own spend. Referral loops and reciprocal or circular structures designed to route spend back to the referrer are prohibited. Buying, selling, renting or auctioning referral links or downline positions is prohibited.\", \"Also prohibited: spam of any kind, including unsolicited bulk email, messaging-app blasts and comment spam; paid search or social advertising that bids on Members Trail brand terms without written approval; impersonating Members Trail, its staff or its channels; incentivising sign-ups with cash or other payments outside the platform; cookie stuffing, forced clicks and any technical manipulation of attribution; and using bots or scripts to create accounts or generate gameplay in a downline.\", \"Detection is automated and continuous. Shared device fingerprints, shared payment instruments, shared addresses, circular structures, sign-up bursts and downlines with spend but no genuine gameplay all raise cases under the AML/KYC Policy. Confirmed breaches void the affected commissions, may remove you from the programme permanently, and in serious cases close the account.\"], \"heading\": \"6. Prohibited referral conduct\"}, {\"body\": [\"You may not make a guaranteed-income claim. You may not state or imply that a person who joins will earn a particular amount, that earnings are assured, passive, risk-free or predictable, or that the programme replaces employment. You may not publish your own earnings as an example of what a recruit can expect, because a personal result is not a representative one.\", \"You may not present the programme or MTT as an investment, a return, a yield, a fund or anything with an expected rate. You may not promise a token price. You may not use the words guaranteed, risk-free, assured or passive income in connection with the programme.\", \"When you promote the programme publicly you must use the approved assets and language from the marketing assets page, disclose clearly that you receive a commission, and not remove or alter the disclaimers that come with those assets. Anything you write yourself must remain accurate and must not imply an outcome the programme does not offer.\", \"Where you spend money to promote the programme, that is your commercial decision and your risk. We do not reimburse advertising costs, and spending on promotion does not increase your cap or create any entitlement to commission.\"], \"heading\": \"7. Marketing conduct and income claims\"}, {\"body\": [\"Commission is calculated per qualifying transaction, at the rate for the level the spending member sits at relative to you, on the net eligible amount. Each line item in your Commission Payout History shows the transaction type, the level, the rate applied, the gross and net amounts, the Treasury deposit reference that funded it, the cap headroom at the time, and its status.\", \"Line items move through accruing, pending verification, cleared, released and, where relevant, reversed. Cleared commission is released after the refund and chargeback window on the underlying transaction has passed and your verification is complete.\", \"If a line item looks wrong — a missing referral, a wrong level, an unexpected reversal, an incorrect cap calculation — raise a dispute from that line item in the payout history. Disputes are worked from the ledger and the audit log, you get a written outcome with the figures we relied on, and you can ask for a second review by someone not involved in the first decision. Raise disputes within 90 days of the line item appearing, so the underlying records are still within their working retention window.\"], \"heading\": \"8. Calculation, statements and disputes\"}, {\"body\": [\"We may reverse a commission where the underlying transaction is refunded, charged back or reversed by the payment provider; where the transaction, the account or the referral relationship is found to be fraudulent; where the spend was generated by automation, collusion or a prohibited structure; or where the commission was paid in error, including a calculation or attribution error on our side.\", \"A clawback is applied first against unreleased commission. Where the commission has already been released, the amount becomes a negative adjustment recovered from subsequent commissions, and in a case of fraud it may be recovered from a withdrawable balance. Clawbacks apply up the chain: a reversed transaction removes the level 1, level 2 and level 3 commissions it generated, for every upline that benefited.\", \"Every clawback appears as a reversal line in your payout history with the reason and the reference of the original line item, and is disputable through the same process. We do not silently adjust a balance.\"], \"heading\": \"9. Clawback\"}, {\"body\": [\"We may change the rates, the caps, the eligible transaction types, the depth, the eligibility requirements or the detection rules, and we may suspend or discontinue the programme. Changes apply prospectively from a published effective date and are notified in advance in-product and by email.\", \"Changes do not apply retroactively to commission you have already properly earned and that has been released after verification. Commission still accruing at the time a change takes effect is settled under the rules in force when the underlying transaction occurred.\", \"If the programme is discontinued, we will publish a wind-down date, keep the payout history accessible, and settle properly earned commission that has cleared its refund window and passed verification.\"], \"heading\": \"10. Changes to the programme\"}, {\"body\": [\"Commission may be taxable income where you live, and you are responsible for declaring and paying any tax on it, and for any registration, invoicing or reporting obligation your local rules impose. We do not provide tax advice.\", \"Where a law that applies to us requires it, we may withhold tax, request a tax identification number or self-certification, or report payments to a tax authority. A commission payout can be held until the information we are legally required to collect has been provided.\", \"You participate as an independent party. Nothing in these terms creates employment, agency, partnership or a joint venture, and you may not hold yourself out as an employee, agent or spokesperson of Members Trail or make commitments on our behalf.\"], \"heading\": \"11. Tax and your own status\"}, {\"body\": [\"This Referral / Affiliate Program Terms document is a structural draft. It was written to define the required content, sections and clauses for the development and legal teams, and it is not ready-to-publish legal text.\", \"A licensed attorney in each operating jurisdiction must review, adapt and approve the final language before publication. Requirements differ significantly by country and by state, and they differ again depending on whether the platform is classified locally as gaming, gambling, e-commerce or a financial service.\", \"Nothing in this document is legal, tax or financial advice, and nothing in it creates a relationship of adviser and client between you and Members Trail. If you need advice about how this document applies to your own circumstances, consult a qualified professional in your jurisdiction.\", \"Questions about this policy, including data-subject requests and compliance enquiries, should go to the compliance team through /contact rather than to general support.\"], \"heading\": \"Draft status and legal notice\"}]',1,'2026-09-01 00:00:00.000000',NULL,'ef59688c-7ab0-4bc8-8f92-0a59cd725e43',NULL),('c070e415-69f5-4d28-a696-f917cfb10649','2026-08-24 08:21:04.656875','2026-08-24 08:21:04.656875','terms','Terms & Conditions','1.0','legal_review','You must be 18 or older, use one account, and play from a country we are allowed to serve. Points are a non-transferable balance we issue for gameplay, and MTT is a utility token for using the platform — neither is an investment and neither carries a promise of value. Referring other players is optional, free and capped, and it is never required to play, earn or withdraw. If we materially change these terms you will be asked to accept them again before you can keep using your account.','[{\"body\": [\"These Terms & Conditions form a binding agreement between you and Members Trail. You accept them when you create an account, and you accept them again each time you log in after a materially changed version has been published. If you do not accept them, do not register and do not use the platform.\", \"To accept these terms you must have the legal capacity to enter a contract in your country of residence. You must be at least 18 years old, or older if the minimum age for paid online gaming where you live is higher. We will close any account we find to belong to a person under the applicable minimum age and return any recoverable balance to the payment source it came from, subject to our verification obligations.\", \"Some parts of the platform are governed by additional documents: the Privacy Policy, the Risk Disclosure Statement, the AML/KYC Policy, the Referral Program Terms, the Refund & Cancellation Policy, the Responsible Gaming Policy and the Cookie Policy. Those documents are incorporated into these terms by reference. Where a specific document conflicts with these general terms on a point it governs, the specific document controls.\"], \"heading\": \"1. Acceptance of these terms\"}, {\"body\": [\"Members Trail is a skill-based gaming platform. You play games, complete quests and enter tournaments, and the platform issues Points for qualifying activity according to published rules and daily caps. Points can be converted into MTT, a utility token used inside the platform, at the conversion rate published at the time of conversion.\", \"Around the games sit three optional features: a wallet for holding and withdrawing MTT, a staking module that pays a variable reward from platform revenue, and a referral programme that pays a capped commission when people you introduce spend real money on the platform. All three are optional. You can play, earn Points and convert them without ever staking or referring anyone.\", \"One rule governs the entire economy and we state it plainly here because it defines what we can and cannot promise: every payout — staking reward, referral commission and prize pool — is funded from real platform revenue held in the Revenue Treasury. No payout is funded by another member\'s deposit. A direct consequence is that no yield, commission or return can be fixed or guaranteed in advance, and we do not present any of them as such anywhere on the platform.\"], \"heading\": \"2. What Members Trail is\"}, {\"body\": [\"The platform is available only in jurisdictions where skill-based gaming with a token rewards layer is lawful and where we have completed a legal review. A restricted-territory list is maintained by the legal team and enforced at registration through a cross-check of your declared country of residence against the geolocation of your connection. Sign-ups from restricted or sanctioned territories are rejected.\", \"When you register you represent that the country of residence you declare is accurate, that you are not a resident of a restricted territory, and that you are not subject to sanctions administered by any authority whose lists we screen against. Using a VPN, proxy or false residency declaration to reach the platform from a restricted territory is a material breach of these terms and grounds for closure of your account and forfeiture of Points issued while the misrepresentation was in force.\", \"If a jurisdiction becomes restricted after you have registered, we will tell you, stop issuing new Points for your account, disable paid features and give you a reasonable window to withdraw any withdrawable balance, subject to identity verification and any legal hold that applies.\"], \"heading\": \"3. Eligibility and geographic restrictions\"}, {\"body\": [\"You may hold one account. Registering or operating more than one account, whether directly or through another person acting for you, is prohibited. This is not administrative fussiness: multi-accounting distorts leaderboards, defeats daily Points caps and is the most common vector for referral fraud, so we treat it as a serious breach.\", \"Information you give us must be accurate and kept up to date, and it must match the identity documents you later submit for verification. A mismatch between your declared identity and your documents will hold your withdrawals until it is resolved.\", \"You are responsible for your credentials, for the security of the email address and phone number attached to the account, and for enabling two-factor authentication where we offer it. Activity conducted with your credentials is treated as your activity unless you can show the account was compromised despite reasonable care. Tell us immediately through /contact if you believe your account has been accessed by someone else.\"], \"heading\": \"4. Your account\"}, {\"body\": [\"Points are an off-chain balance we issue and record on our own ledger. They are not a currency, not a security, not a deposit and not a claim on any asset. They are non-transferable: you cannot send Points to another member, sell them, or assign them to anyone. Points have no cash value and cannot be redeemed for cash; their only uses are the in-platform uses we publish, including conversion to MTT.\", \"Issuance rates, daily caps per game, quest rewards and the Points-to-MTT conversion rate are configuration, and we may change them prospectively. Changes never reduce a Points balance you have already earned, and a scheduled change to the conversion rate is published with its effective date before it takes effect so you can decide whether to convert before or after.\", \"Points may expire after a period of account inactivity, and that period is stated in your Points history. We may reverse Points that were issued in error, issued for activity that breached these terms, or issued through a bug or automation. Where a reversal happens we record the reason on your Points history so the adjustment is auditable rather than silent.\"], \"heading\": \"5. Points\"}, {\"body\": [\"MTT is a utility token whose purpose is participation in the platform: paying for entries and items, staking into revenue-funded pools, and receiving commissions and rewards. MTT is not offered or marketed as an investment, and buying, earning or holding it gives you no ownership interest in Members Trail, no share of profits, no dividend and no voting right over the company.\", \"We make no promise that MTT will have, keep or gain any market value, and no promise that a market for it will exist. If MTT becomes tradable, its price may fluctuate significantly and may fall to zero. Read the Risk Disclosure Statement before you convert Points to MTT, stake, or hold a balance you would be unwilling to lose.\", \"If you use a self-custodied wallet, you and only you hold the private keys. We cannot move, freeze, restore or recover assets in a wallet we do not control, and we cannot reverse a transaction you have signed. You are responsible for the accuracy of any address you paste, for the network you send on, and for the gas fees that on-chain actions cost.\"], \"heading\": \"6. MTT token\"}, {\"body\": [\"Staking locks MTT into a pool for a defined period in exchange for a reward calculated from Treasury inflows for that period. The reward rate is variable and is recalculated from real revenue; it is not an interest rate, it is not fixed, and it is not guaranteed. A period with low platform revenue produces a low reward, and a period with no revenue can produce no reward at all.\", \"Each pool publishes its lock period, its early-unstake penalty and its minimum stake before you commit. During the lock period your principal is not available to you. Unstaking early, where the pool allows it, applies the published penalty to the reward, the principal or both, exactly as stated on the pool.\", \"Staking happens in a smart contract. That contract may contain bugs or be exploited, and no audit removes that risk. Our contracts are deployed to testnet first and an independent audit is planned but not yet complete; until it is published, treat staking as an activity carrying a real possibility of total loss of the staked amount.\"], \"heading\": \"7. Staking\"}, {\"body\": [\"The referral programme is governed by the Referral Program Terms, which control on every point they cover. The headline facts are repeated here because they define what the programme is and is not.\", \"Joining costs nothing. There is no entry fee, no pack to buy, no minimum spend and no requirement to recruit anyone. Referring is optional and is never a condition of playing, earning Points, converting, staking or withdrawing. Commission is paid on three levels at 8%, 3% and 1% of eligible real-money spend by the people in those levels — never on their deposits, never on their stake principal, and never on their token balances.\", \"Commission is capped every month, is paid only from the Revenue Treasury, and is released only after Tier 1 identity verification. Presenting the programme as an investment, promising anyone an income, or publishing an earnings figure someone else can expect to make is prohibited and is grounds for removal from the programme.\"], \"heading\": \"8. Referral programme\"}, {\"body\": [\"The following are prohibited: operating more than one account; using bots, scripts, emulators or any automation to generate gameplay, Points or referrals; colluding with other players to manipulate a tournament or leaderboard; exploiting a bug instead of reporting it; reverse engineering or interfering with the platform, its contracts or its anti-fraud systems; and using the platform to launder money or move the proceeds of crime.\", \"Also prohibited, and specific to the referral programme: creating accounts to refer yourself, arranging circular or reciprocal referrals, buying or selling referral links, incentivising sign-ups with payments outside the platform, and spamming. Marketing conduct that makes a guaranteed-income claim, implies an investment return, or presents the programme as a business opportunity with a projected earnings figure is prohibited whether or not the claim is sincere.\", \"Where we find prohibited conduct we may reverse the Points and commissions it produced, void affected tournament results, suspend or close the account, and clawback commission already paid to the upline that benefited from it. Serious cases involving suspected financial crime are escalated under the AML/KYC Policy and may be reported to the relevant authority.\"], \"heading\": \"9. Prohibited conduct\"}, {\"body\": [\"Fees are disclosed before you confirm the action that incurs them. In-app purchases show their total price including applicable tax at checkout. Tournament entries show the entry cost and the prize-pool structure on the tournament card. Marketplace listings show the platform fee taken from the sale. Withdrawals show the processing fee and, for on-chain withdrawals, an estimate of the network gas cost, which is paid to the network and not to us.\", \"We may change fees prospectively. A change is published in the fee schedule with an effective date, and it does not apply to a transaction you have already confirmed. Third-party costs — card scheme fees, app store commission, blockchain gas — are set by those third parties and can change without notice from us.\", \"You are responsible for any tax arising from your use of the platform, including tax on referral commission, staking rewards and disposals of MTT. We do not provide tax advice and we do not withhold tax on your behalf unless a law that applies to us requires it.\"], \"heading\": \"10. Fees\"}, {\"body\": [\"Withdrawals and the release of referral commission require identity verification under the AML/KYC Policy. Tier 1 is a government identity document plus a liveness selfie. Tier 2, which adds proof of address and may require evidence of source of funds, is triggered when your cumulative withdrawals pass the published threshold or when monitoring flags your account for review.\", \"We may freeze a balance, hold a withdrawal or pause commission release while an investigation is open. We will tell you that a hold exists and what we need from you, but we may be legally prevented from telling you the detailed reason where a suspicious activity report has been filed.\", \"Verification also protects you: it is what lets us prove an account is yours before we send funds to a new destination. New withdrawal addresses are subject to a cooling-off period of 24 to 48 hours before the first withdrawal to them is released.\"], \"heading\": \"11. Identity verification, freezes and holds\"}, {\"body\": [\"The platform, the games, the artwork, the Members Trail name and logo, the interface and the underlying software are owned by us or licensed to us. You get a limited, personal, non-exclusive, non-transferable and revocable licence to use them for playing on the platform, and nothing more.\", \"You may not copy, distribute, modify, publicly display, sell or create derivative works from platform content except where we give you approved marketing assets and you use them within the rules in the Referral Program Terms. You may not use our marks in a way that implies we endorse you, your content or your income claims.\", \"Content you submit — a display name, an avatar, a support message, a review — remains yours, but you grant us a licence to host, display and use it for operating and moderating the platform. We may remove content that is unlawful, abusive, misleading or in breach of these terms.\"], \"heading\": \"12. Intellectual property\"}, {\"body\": [\"The platform is provided on an as-is and as-available basis. We do not warrant that it will be uninterrupted, error-free or secure against every attack, that games will always be available, that a tournament will always fill, or that an on-chain transaction will confirm in a given time. We disclaim all implied warranties to the maximum extent the law where you live allows.\", \"We give no warranty and make no representation about earnings. There is no guaranteed staking yield, no guaranteed commission, no guaranteed prize and no guaranteed value for MTT or Points. Most participants in the referral programme earn a small amount or nothing at all, and you should assume that outcome for yourself.\", \"To the maximum extent permitted by law, our total liability to you for all claims arising out of or relating to the platform is limited to the greater of the amount you paid us in the twelve months before the claim arose or a nominal sum to be fixed by counsel in the final text. We are not liable for indirect, incidental, special, consequential or punitive damages, for lost profits or lost opportunity, for the market value of MTT, or for losses caused by a third-party network, wallet or payment provider. Nothing in these terms excludes liability that cannot lawfully be excluded, including liability for fraud or for death or personal injury caused by negligence.\"], \"heading\": \"13. Disclaimers and limitation of liability\"}, {\"body\": [\"You agree to indemnify and hold harmless Members Trail, its officers, employees and contractors against claims, losses, liabilities and reasonable costs arising from your breach of these terms, your infringement of a third party\'s rights, your unlawful use of the platform, or income claims and other marketing statements you make about the referral programme.\", \"We will tell you promptly about any claim we expect you to indemnify, give you a reasonable opportunity to participate in the defence, and not settle a claim in a way that imposes an obligation on you without your consent.\"], \"heading\": \"14. Indemnification\"}, {\"body\": [\"You may close your account at any time from your settings. Closure does not cancel obligations that survive it: an open investigation continues, a chargeback can still be applied against you, and AML records are retained for the period the law requires even after your account is gone.\", \"We may suspend or close an account for breach of these terms, suspected fraud or financial crime, a failed or abandoned verification, a legal or regulatory requirement, or conduct that puts other members at risk. Except where a legal restriction or an active investigation prevents it, we will tell you what happened, what evidence we relied on at a level of detail that does not compromise our fraud controls, and how to dispute the decision.\", \"On closure we will pay out a verified withdrawable balance, less any amount subject to clawback, refund, chargeback or legal hold. Points that have not been converted, unvested rewards and unreleased commissions do not survive closure for cause.\"], \"heading\": \"15. Suspension and termination\"}, {\"body\": [\"Start with us. Almost every dispute is a factual disagreement about a specific transaction, and the support and commission-dispute processes are built to resolve those quickly and with an audit trail. Raise a ticket through /contact and give us a reasonable period — to be fixed in the final text, expected to be 30 days — to investigate before escalating.\", \"If a dispute cannot be resolved that way, the final text will specify the governing law, the venue, and whether disputes go to binding individual arbitration or to the courts of the governing jurisdiction. Class actions and representative proceedings are expected to be excluded to the extent the law allows.\", \"These clauses are jurisdiction-sensitive and are among the sections most likely to change on attorney review. Consumer-protection law in some countries makes an arbitration clause or a class-action waiver unenforceable against consumers, and where that is the case the local rule prevails and your statutory rights are unaffected.\"], \"heading\": \"16. Dispute resolution and governing law\"}, {\"body\": [\"Every version of this document is stored in the platform CMS with a draft, legal-review and published workflow, a version number and a full history, so you can see what changed and when.\", \"A non-material change — a clarification, a corrected reference, a formatting fix — takes effect on publication and is listed in the version history. A material change, meaning one that affects your rights, your money or your obligations, is notified in advance and requires you to accept the new version at your next login. Until you accept it, access to paid features is paused; your existing balance is not affected by the pause.\", \"If you do not accept a material change you may close your account and withdraw your verified balance under the normal withdrawal rules. Continuing to use the platform after accepting a version means that version applies to you.\"], \"heading\": \"17. Changes to these terms\"}, {\"body\": [\"General support, account questions and transaction disputes: raise a ticket at /contact. Compliance matters, data-subject requests and legal notices go to the compliance team through the same form using the compliance category, which routes away from general support.\", \"The registered company name, address, registration number and any licence details will be inserted here before publication and must match the entity that contracts with members in each jurisdiction.\"], \"heading\": \"18. Contact\"}, {\"body\": [\"This Terms & Conditions document is a structural draft. It was written to define the required content, sections and clauses for the development and legal teams, and it is not ready-to-publish legal text.\", \"A licensed attorney in each operating jurisdiction must review, adapt and approve the final language before publication. Requirements differ significantly by country and by state, and they differ again depending on whether the platform is classified locally as gaming, gambling, e-commerce or a financial service.\", \"Nothing in this document is legal, tax or financial advice, and nothing in it creates a relationship of adviser and client between you and Members Trail. If you need advice about how this document applies to your own circumstances, consult a qualified professional in your jurisdiction.\", \"Questions about this policy, including data-subject requests and compliance enquiries, should go to the compliance team through /contact rather than to general support.\"], \"heading\": \"Draft status and legal notice\"}]',1,'2026-09-01 00:00:00.000000',NULL,'ef59688c-7ab0-4bc8-8f92-0a59cd725e43',NULL),('c66f0be9-593c-4595-95ac-b556b3753130','2026-08-24 08:21:04.687834','2026-08-24 08:21:04.687834','responsible-gaming','Responsible Gaming Policy','1.0','legal_review','You can set your own deposit, spend and session limits, and a tightening takes effect immediately. Cooling-off pauses paid features for a short period you choose. Self-exclusion is stronger: it takes effect at once and support cannot lift it during the period you set, no matter who asks — including you. Reality checks tell you how long you have been playing and what you have spent. The platform is 18+ and an account found to belong to a minor is closed.','[{\"body\": [\"Members Trail is entertainment. For most people it stays that way, and for some it does not, and a platform that takes money for play has an obligation to build for the second case rather than hope it away.\", \"Our approach has four parts: give you real tools to bound your own play and spending; make the tools easy to find and immediate to apply; watch for behavioural indicators of harm and intervene rather than optimise them; and never design a mechanic whose purpose is to make it harder to stop. Loss-chasing prompts, urgency timers on spending decisions and the promotion of paid features to a member who has just set a limit are all off the table.\", \"We also do not target responsible-gaming tooling as an obstacle to be minimised. Setting a limit takes fewer steps than making a purchase, and it should stay that way.\"], \"heading\": \"1. Our commitment\"}, {\"body\": [\"Deposit limits: a maximum you can add to your account per day, per week or per month. Spend limits: a maximum on in-app purchases, tournament entries and marketplace purchases over the same periods, which catches spending funded from an existing balance rather than a new deposit. Session limits: a maximum length of a single play session, after which the session ends.\", \"A tightening — a lower limit, a shorter session — applies immediately. A loosening does not: raising or removing a limit takes effect only after a cooling-off delay of 24 hours, and you are asked to confirm again when the delay ends. That asymmetry is deliberate, because the moment you want to raise a limit is exactly the moment the limit is doing its job.\", \"Limits are enforced server-side, apply across every device and every entry point, and cannot be bypassed by using a different client. If you hit a limit, the platform tells you which limit it was and when it resets, rather than failing silently.\", \"Free play is not restricted by spend limits. You can keep playing games and earning Points with every paid feature closed off, which is the point: the tools bound your spending, not your access.\"], \"heading\": \"2. Limits you can set yourself\"}, {\"body\": [\"Reality checks are periodic in-play notices — at an interval you choose, commonly 30 or 60 minutes — that state how long the session has run, what you have spent in it, and the net result. Acknowledging one requires a deliberate action rather than a stray tap, and you can end the session from the notice.\", \"Your account has a permanent activity summary: deposits, purchases, entries, time played and net position over the last 7, 30 and 90 days, and over the last year. It is not buried, it is not selectively framed, and it shows losses with the same prominence as wins.\", \"Notifications that promote paid features can be turned off independently of transactional and security notifications, so silencing marketing never means silencing a security alert.\"], \"heading\": \"3. Reality checks and your own numbers\"}, {\"body\": [\"Cooling-off is a short, self-chosen break. You pick a period — 24 hours, 7 days or 30 days — and paid features are disabled for it: no deposits, no purchases, no tournament entries, no staking actions.\", \"Cooling-off starts as soon as you confirm it and cannot be cancelled early. During the period you can still access your account, see your balances, withdraw a verified balance, and play free games unless you chose the option that pauses gameplay too.\", \"Marketing communication stops during a cooling-off period and does not resume automatically at the end. When the period expires the account returns to normal and any limits you had set remain in force; cooling-off does not reset them.\"], \"heading\": \"4. Cooling-off\"}, {\"body\": [\"Self-exclusion is the strongest tool and it is designed to be hard to undo. You choose a period — 6 months, 1 year, 5 years or permanent — and it takes effect immediately on confirmation. Paid features close, marketing stops permanently for that account, and the account is flagged so that a new account created with matching identity, payment or device details is blocked as well.\", \"During the exclusion period support cannot lift it. Not for a good reason, not for a policy exception, not for a member who calls and says they have changed their mind, and not for anyone claiming to act for you. This is the whole value of the mechanism: the version of you who set it is protecting you from the version of you who wants it lifted, and a support agent who can be talked round destroys that protection. Agents are trained to say no and are not given the ability to override it.\", \"You keep the right to withdraw a verified balance during exclusion, subject to the normal AML checks, and to access your records and exercise your data rights. What you cannot do is deposit, spend or play paid features.\", \"At the end of a fixed period the exclusion does not lift automatically. You must ask for reinstatement, wait out a further cooling-off delay, and confirm again, and we may keep limits in place or decline reinstatement where we hold indicators of harm. A permanent exclusion is not reversible.\"], \"heading\": \"5. Self-exclusion\"}, {\"body\": [\"The platform is for adults: 18 or older, or older where local law sets a higher minimum for paid online gaming. Age is declared at registration and checked against the date of birth on the identity document at verification, which is required before any withdrawal or commission release.\", \"An account found to belong to a person under the applicable age is closed immediately. No winnings, staking rewards or referral commission are paid, recoverable payments are returned to the source they came from, and the data is deleted except what we must keep to document the closure.\", \"If you share a device with someone under 18, use the device-level parental controls your operating system provides, keep payment credentials out of saved autofill, and do not leave a session logged in. If you believe a minor is using the platform — including your own child — report it through /contact and it will be handled as urgent by the compliance team.\"], \"heading\": \"6. Age verification and underage protection\"}, {\"body\": [\"Some patterns are worth recognising in yourself: spending more than you planned, or more than you can comfortably afford; playing longer than you intended and repeatedly; increasing your spend to recover a loss; borrowing money, selling things or using money set aside for something else in order to play; hiding how much you play or spend from people close to you; feeling irritable or anxious when you cannot play; playing to escape stress, boredom or low mood rather than for enjoyment; and neglecting work, study, sleep or relationships because of it.\", \"One of these on a bad week is not a diagnosis. Several of them, persistently, is a reason to use the tools in this policy today rather than to plan on using them later.\", \"The same applies to the referral programme. Spending money on advertising to build a downline, or spending on the platform in order to raise your commission cap, is a spending decision like any other, and the same warning signs apply. Referral commission is capped and most participants earn little or nothing, so treating downline building as a way out of a loss is a route into a bigger one.\"], \"heading\": \"7. Signs that play has stopped being play\"}, {\"body\": [\"Support that helps is support that is local, and the right organisation depends on where you live. Rather than printing a phone number here that may be wrong, out of date or in the wrong country, we maintain a current list of resources for each market we operate in and surface it in-product: in the responsible-gaming section of your account settings, in the limits and self-exclusion flows, and in the confirmation of a cooling-off or exclusion.\", \"The categories of resource on that list are: national or regional problem-gambling and gaming-disorder helplines, which are typically free and confidential and often available around the clock; independent counselling and treatment services, including services that specialise in behavioural addiction; peer support and mutual-aid groups, in person and online, including groups for affected family members; free debt advice and financial counselling charities, which matter because financial pressure is often the most urgent part of the harm; and general mental health services, since problem play frequently travels with anxiety, depression or another underlying condition.\", \"We also point to blocking software that can restrict access to gaming and gambling sites across a device or a household network, and to bank-level tools that many banks now offer to block gambling-category payments.\", \"If you are in immediate distress or crisis, contact your local emergency services or a crisis line in your country. Our support team can send you the current resource list for your region on request, but we are not a clinical service and we will not pretend to be one.\"], \"heading\": \"8. Support resources\"}, {\"body\": [\"Monitoring looks for behavioural markers of harm rather than for spend alone: a sharp escalation in deposit frequency or size relative to a member\'s own baseline, repeated failed payment attempts, sessions running through the night, spending immediately after a large loss, cancelled withdrawals followed by immediate spending, and repeated raising of self-set limits.\", \"A first-tier response is automated and low-friction: a reality check, a prompt to review limits, and a temporary stop on promotional messaging. A stronger signal escalates to a trained member of the team who may impose a temporary limit, place a hold on paid features pending contact, or in a serious case close paid access.\", \"We do not use these signals for marketing and we do not target offers at members who show them. A member showing harm markers is removed from promotional targeting rather than moved up it.\", \"Interventions and their outcomes are recorded so that a later decision — a reinstatement request, for example — is made with the full history rather than from scratch.\"], \"heading\": \"9. How we intervene\"}, {\"body\": [\"Every member-facing employee completes responsible-gaming training on joining and at least annually, covering the indicators of harm, how to respond to a member who discloses a problem, the limits of their own role, and the rule that a self-exclusion is not negotiable.\", \"A named senior owner is accountable for this policy, and responsible-gaming metrics — tool uptake, exclusion volumes, intervention outcomes — are reported internally alongside commercial metrics rather than instead of them. Product changes that touch spending, session length or promotional messaging are reviewed against this policy before release.\", \"The policy, the tools and the intervention thresholds are reviewed at least annually and after any material product change, and against the standards of each market\'s regulator.\"], \"heading\": \"10. Staff training and accountability\"}, {\"body\": [\"This Responsible Gaming Policy is a structural draft. It was written to define the required content, sections and clauses for the development and legal teams, and it is not ready-to-publish legal text.\", \"A licensed attorney in each operating jurisdiction must review, adapt and approve the final language before publication. Requirements differ significantly by country and by state, and they differ again depending on whether the platform is classified locally as gaming, gambling, e-commerce or a financial service.\", \"Nothing in this document is legal, tax or financial advice, and nothing in it creates a relationship of adviser and client between you and Members Trail. If you need advice about how this document applies to your own circumstances, consult a qualified professional in your jurisdiction.\", \"Questions about this policy, including data-subject requests and compliance enquiries, should go to the compliance team through /contact rather than to general support.\"], \"heading\": \"Draft status and legal notice\"}]',0,'2026-09-01 00:00:00.000000',NULL,'ef59688c-7ab0-4bc8-8f92-0a59cd725e43',NULL);
/*!40000 ALTER TABLE `legal_documents` ENABLE KEYS */;
UNLOCK TABLES;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER `trg_legal_published_immutable` BEFORE UPDATE ON `legal_documents` FOR EACH ROW BEGIN
        IF OLD.status = 'published'
           AND (NEW.sections <> OLD.sections OR NEW.summary <> OLD.summary
                OR NEW.version <> OLD.version OR NEW.slug <> OLD.slug)
           AND COALESCE(@mt_maintenance, 0) <> 1 THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'LEGAL_PUBLISHED_IMMUTABLE: publish a new version instead of editing a published one.';
        END IF;
      END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;

--
-- Table structure for table `login_history`
--

DROP TABLE IF EXISTS `login_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `login_history` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `userId` varchar(255) DEFAULT NULL,
  `identifier` varchar(320) DEFAULT NULL,
  `success` tinyint NOT NULL,
  `failureReason` varchar(64) DEFAULT NULL,
  `ip` varchar(45) DEFAULT NULL,
  `userAgent` varchar(400) DEFAULT NULL,
  `fingerprint` varchar(128) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_login_ip` (`ip`),
  KEY `idx_login_user_time` (`userId`,`createdAt`),
  CONSTRAINT `fk_login_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `login_history`
--

LOCK TABLES `login_history` WRITE;
/*!40000 ALTER TABLE `login_history` DISABLE KEYS */;
INSERT INTO `login_history` (`id`, `createdAt`, `updatedAt`, `userId`, `identifier`, `success`, `failureReason`, `ip`, `userAgent`, `fingerprint`) VALUES ('9d0299f8-900e-414a-b595-58634d3b087e','2026-08-24 08:22:01.262751','2026-08-24 08:22:01.262751','ef59688c-7ab0-4bc8-8f92-0a59cd725e43','ops@memberstrail.local',0,'bad_password','127.0.0.1','curl/8.5.0',NULL);
/*!40000 ALTER TABLE `login_history` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `market_listings`
--

DROP TABLE IF EXISTS `market_listings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `market_listings` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `ref` varchar(32) NOT NULL,
  `sellerId` varchar(255) NOT NULL,
  `inventoryItemId` varchar(255) NOT NULL,
  `itemId` varchar(255) NOT NULL,
  `askMtt` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `status` enum('active','sold','cancelled','expired') NOT NULL DEFAULT 'active',
  `buyerId` varchar(255) DEFAULT NULL,
  `feeMtt` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `revenueEventId` varchar(255) DEFAULT NULL,
  `soldAt` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_2627f35bb9965fef90c4694b40` (`ref`),
  KEY `idx_listing_status` (`status`),
  KEY `idx_listing_status_created` (`status`,`createdAt`),
  KEY `fk_listing_seller` (`sellerId`),
  KEY `fk_listing_item` (`itemId`),
  KEY `fk_listing_inv` (`inventoryItemId`),
  CONSTRAINT `fk_listing_inv` FOREIGN KEY (`inventoryItemId`) REFERENCES `user_inventory` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_listing_item` FOREIGN KEY (`itemId`) REFERENCES `store_items` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_listing_seller` FOREIGN KEY (`sellerId`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `market_listings`
--

LOCK TABLES `market_listings` WRITE;
/*!40000 ALTER TABLE `market_listings` DISABLE KEYS */;
/*!40000 ALTER TABLE `market_listings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `migrations`
--

DROP TABLE IF EXISTS `migrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `migrations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `timestamp` bigint NOT NULL,
  `name` varchar(255) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `migrations`
--

LOCK TABLES `migrations` WRITE;
/*!40000 ALTER TABLE `migrations` DISABLE KEYS */;
INSERT INTO `migrations` (`id`, `timestamp`, `name`) VALUES (1,1787296447691,'InitialSchema1787296447691'),(2,1787900000000,'AddTwoFaVerificationPurpose1787900000000'),(3,1788100000000,'DatabaseHardeningAndOptimisation1788100000000');
/*!40000 ALTER TABLE `migrations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `notification_deliveries`
--

DROP TABLE IF EXISTS `notification_deliveries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `notification_deliveries` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `notificationId` varchar(255) DEFAULT NULL,
  `userId` varchar(255) NOT NULL,
  `channel` enum('email','sms','push','in_app') NOT NULL,
  `target` varchar(320) NOT NULL,
  `status` enum('queued','sent','delivered','failed','suppressed') NOT NULL DEFAULT 'queued',
  `attempts` int NOT NULL DEFAULT '0',
  `lastError` text,
  `providerMessageId` varchar(128) DEFAULT NULL,
  `sentAt` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_delivery_status` (`status`),
  KEY `fk_delivery_user` (`userId`),
  KEY `fk_delivery_notif` (`notificationId`),
  CONSTRAINT `fk_delivery_notif` FOREIGN KEY (`notificationId`) REFERENCES `notifications` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_delivery_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `notification_deliveries`
--

LOCK TABLES `notification_deliveries` WRITE;
/*!40000 ALTER TABLE `notification_deliveries` DISABLE KEYS */;
/*!40000 ALTER TABLE `notification_deliveries` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `notification_preferences`
--

DROP TABLE IF EXISTS `notification_preferences`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `notification_preferences` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `userId` varchar(255) NOT NULL,
  `channels` json NOT NULL,
  `marketingOptIn` tinyint NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_b70c44e8b00757584a39322559` (`userId`),
  UNIQUE KEY `REL_b70c44e8b00757584a39322559` (`userId`),
  CONSTRAINT `FK_b70c44e8b00757584a393225593` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `notification_preferences`
--

LOCK TABLES `notification_preferences` WRITE;
/*!40000 ALTER TABLE `notification_preferences` DISABLE KEYS */;
INSERT INTO `notification_preferences` (`id`, `createdAt`, `updatedAt`, `userId`, `channels`, `marketingOptIn`) VALUES ('1715a4f6-379d-477f-a885-ea4ff507c3aa','2026-08-24 08:21:04.297232','2026-08-24 08:21:04.297232','eb013524-5668-4248-9b42-2af536f5f7ab','{\"kyc\": {\"sms\": false, \"push\": true, \"email\": true}, \"promo\": {\"sms\": false, \"push\": false, \"email\": false}, \"reward\": {\"sms\": false, \"push\": true, \"email\": false}, \"system\": {\"sms\": false, \"push\": false, \"email\": true}, \"commission\": {\"sms\": false, \"push\": true, \"email\": true}, \"tournament\": {\"sms\": false, \"push\": true, \"email\": false}, \"transaction\": {\"sms\": false, \"push\": true, \"email\": true}}',0),('1b97ec18-2b72-4f6c-91c7-89e3b16aa657','2026-08-24 08:21:04.340867','2026-08-24 08:21:04.340867','ba11a375-3ddf-4672-a20b-662741f8aec2','{\"kyc\": {\"sms\": false, \"push\": true, \"email\": true}, \"promo\": {\"sms\": false, \"push\": false, \"email\": false}, \"reward\": {\"sms\": false, \"push\": true, \"email\": false}, \"system\": {\"sms\": false, \"push\": false, \"email\": true}, \"commission\": {\"sms\": false, \"push\": true, \"email\": true}, \"tournament\": {\"sms\": false, \"push\": true, \"email\": false}, \"transaction\": {\"sms\": false, \"push\": true, \"email\": true}}',0),('73f3b48a-f65f-462a-ac19-d8fee238679c','2026-08-24 08:21:04.175945','2026-08-24 08:21:04.175945','ef59688c-7ab0-4bc8-8f92-0a59cd725e43','{\"kyc\": {\"sms\": false, \"push\": true, \"email\": true}, \"promo\": {\"sms\": false, \"push\": false, \"email\": false}, \"reward\": {\"sms\": false, \"push\": true, \"email\": false}, \"system\": {\"sms\": false, \"push\": false, \"email\": true}, \"commission\": {\"sms\": false, \"push\": true, \"email\": true}, \"tournament\": {\"sms\": false, \"push\": true, \"email\": false}, \"transaction\": {\"sms\": false, \"push\": true, \"email\": true}}',0),('8f0f4909-cc82-47be-968b-748a100baffe','2026-08-24 08:21:04.245026','2026-08-24 08:21:04.245026','0cb3337b-47ac-4d1c-aeef-7aaee06f2a6c','{\"kyc\": {\"sms\": false, \"push\": true, \"email\": true}, \"promo\": {\"sms\": false, \"push\": false, \"email\": false}, \"reward\": {\"sms\": false, \"push\": true, \"email\": false}, \"system\": {\"sms\": false, \"push\": false, \"email\": true}, \"commission\": {\"sms\": false, \"push\": true, \"email\": true}, \"tournament\": {\"sms\": false, \"push\": true, \"email\": false}, \"transaction\": {\"sms\": false, \"push\": true, \"email\": true}}',0);
/*!40000 ALTER TABLE `notification_preferences` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `notifications`
--

DROP TABLE IF EXISTS `notifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `notifications` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `userId` varchar(255) NOT NULL,
  `kind` enum('transaction','security','kyc','reward','commission','tournament','system','promo') NOT NULL,
  `title` varchar(200) NOT NULL,
  `body` text NOT NULL,
  `href` varchar(300) DEFAULT NULL,
  `read` tinyint NOT NULL DEFAULT '0',
  `readAt` datetime(6) DEFAULT NULL,
  `data` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_notif_created` (`createdAt`),
  KEY `idx_notif_user_read` (`userId`,`read`),
  KEY `idx_notif_read_readat` (`read`,`readAt`),
  CONSTRAINT `fk_notif_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `notifications`
--

LOCK TABLES `notifications` WRITE;
/*!40000 ALTER TABLE `notifications` DISABLE KEYS */;
/*!40000 ALTER TABLE `notifications` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `outbound_transactions`
--

DROP TABLE IF EXISTS `outbound_transactions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outbound_transactions` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `ref` varchar(32) NOT NULL,
  `kind` enum('record_commission','fund_reward_pool','deposit_commission_pool','set_kyc_approved','clawback','transfer','create_pool','set_pool_active') NOT NULL,
  `fromAddress` varchar(42) NOT NULL,
  `toAddress` varchar(42) NOT NULL,
  `functionName` varchar(80) NOT NULL,
  `args` json NOT NULL,
  `nonce` int DEFAULT NULL,
  `status` enum('queued','signing','submitted','confirmed','failed','abandoned') NOT NULL DEFAULT 'queued',
  `txHash` varchar(66) DEFAULT NULL,
  `blockNumber` bigint DEFAULT NULL,
  `gasUsed` bigint DEFAULT NULL,
  `attempts` int NOT NULL DEFAULT '0',
  `lastError` text,
  `relatedType` varchar(60) DEFAULT NULL,
  `relatedId` varchar(64) DEFAULT NULL,
  `idempotencyKey` varchar(128) NOT NULL,
  `submittedAt` datetime(6) DEFAULT NULL,
  `confirmedAt` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_e871ab41a22447355aa4356691` (`ref`),
  UNIQUE KEY `uq_outbound_idem` (`idempotencyKey`),
  KEY `idx_outbound_nonce` (`fromAddress`,`nonce`),
  KEY `idx_outbound_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `outbound_transactions`
--

LOCK TABLES `outbound_transactions` WRITE;
/*!40000 ALTER TABLE `outbound_transactions` DISABLE KEYS */;
/*!40000 ALTER TABLE `outbound_transactions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `outbound_webhooks`
--

DROP TABLE IF EXISTS `outbound_webhooks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outbound_webhooks` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `url` varchar(500) NOT NULL,
  `event` varchar(120) NOT NULL,
  `payload` json NOT NULL,
  `status` enum('queued','sent','failed','abandoned') NOT NULL DEFAULT 'queued',
  `attempts` int NOT NULL DEFAULT '0',
  `lastStatusCode` int DEFAULT NULL,
  `lastError` text,
  `nextRetryAt` datetime(6) DEFAULT NULL,
  `deliveredAt` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_outwh_status` (`status`,`nextRetryAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `outbound_webhooks`
--

LOCK TABLES `outbound_webhooks` WRITE;
/*!40000 ALTER TABLE `outbound_webhooks` DISABLE KEYS */;
/*!40000 ALTER TABLE `outbound_webhooks` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `platform_config`
--

DROP TABLE IF EXISTS `platform_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `platform_config` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `key` varchar(120) NOT NULL,
  `value` json NOT NULL,
  `version` int NOT NULL DEFAULT '1',
  `active` tinyint NOT NULL DEFAULT '1',
  `effectiveFrom` datetime(6) NOT NULL,
  `updatedById` varchar(255) DEFAULT NULL,
  `note` text,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_config_key_version` (`key`,`version`),
  KEY `idx_config_active` (`key`,`active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `platform_config`
--

LOCK TABLES `platform_config` WRITE;
/*!40000 ALTER TABLE `platform_config` DISABLE KEYS */;
INSERT INTO `platform_config` (`id`, `createdAt`, `updatedAt`, `key`, `value`, `version`, `active`, `effectiveFrom`, `updatedById`, `note`) VALUES ('01a9a974-0567-4c1d-83c6-526b6890d712','2026-08-24 08:21:04.447055','2026-08-24 08:21:04.447055','points.caps','{\"dailyGlobal\": 25000, \"perSessionDefault\": 1000, \"perGameDailyDefault\": 3000}',1,1,'2026-08-24 08:21:04.445000','ef59688c-7ab0-4bc8-8f92-0a59cd725e43','Seeded from the env defaults'),('2a4168a0-d6bb-493e-bc37-0e1f6fea088a','2026-08-24 08:21:04.453421','2026-08-24 08:21:04.453421','conversion.caps','{\"dailyPoints\": 25000, \"monthlyPoints\": 400000}',1,1,'2026-08-24 08:21:04.452000','ef59688c-7ab0-4bc8-8f92-0a59cd725e43','Seeded from the env defaults'),('39194699-8f8d-4aca-ab6a-0b16d319d5e4','2026-08-24 08:21:04.467300','2026-08-24 08:21:04.467300','marketplace.policy','{\"feeBps\": 500, \"maxAskMtt\": \"1000000.000000000000000000\", \"minAskMtt\": \"1.000000000000000000\", \"listingTtlDays\": 30}',1,1,'2026-08-24 08:21:04.466000','ef59688c-7ab0-4bc8-8f92-0a59cd725e43','Seeded from the env defaults'),('3a9db85d-5fe4-46ae-bd3b-73707898b0a2','2026-08-24 08:21:04.463113','2026-08-24 08:21:04.463113','treasury.allocation','{\"fiatPerMtt\": \"1.000000000000000000\", \"reserveBps\": 1500, \"allocationBps\": {\"iap\": 3000, \"tournament\": 3000, \"advertising\": 5000, \"marketplace\": 5000, \"subscription\": 3000}}',1,1,'2026-08-24 08:21:04.462000','ef59688c-7ab0-4bc8-8f92-0a59cd725e43','Seeded from the env defaults'),('e099a01e-b4f2-4695-9f3b-0225a262d59e','2026-08-24 08:21:04.458245','2026-08-24 08:21:04.458245','withdrawal.policy','{\"tierLimitsMtt\": {\"0\": \"0.000000000000000000\", \"1\": \"25000.000000000000000000\", \"2\": \"500000.000000000000000000\"}, \"autoApproveMtt\": \"5000.000000000000000000\", \"coolingOffHours\": 48, \"rollingWindowDays\": 30}',1,1,'2026-08-24 08:21:04.457000','ef59688c-7ab0-4bc8-8f92-0a59cd725e43','Seeded from the env defaults');
/*!40000 ALTER TABLE `platform_config` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `points_ledger`
--

DROP TABLE IF EXISTS `points_ledger`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `points_ledger` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `ref` varchar(32) NOT NULL,
  `userId` varchar(255) NOT NULL,
  `source` enum('gameplay','quest','achievement','ad','tournament','purchase','referral_bonus','conversion','admin_adjustment','reversal') NOT NULL,
  `amount` bigint NOT NULL,
  `runningBalance` bigint NOT NULL,
  `gameId` varchar(255) DEFAULT NULL,
  `gameSessionId` varchar(255) DEFAULT NULL,
  `note` varchar(255) DEFAULT NULL,
  `actorId` varchar(255) DEFAULT NULL,
  `approvedById` varchar(255) DEFAULT NULL,
  `idempotencyKey` varchar(128) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_78b81f58351240b75ff6565210` (`ref`),
  UNIQUE KEY `uq_points_idem` (`idempotencyKey`),
  KEY `idx_points_session` (`gameSessionId`),
  KEY `idx_points_source` (`source`),
  KEY `idx_points_user_time` (`userId`,`createdAt`),
  KEY `idx_points_created_source` (`createdAt`,`source`),
  KEY `idx_points_user_amount` (`userId`,`amount`),
  CONSTRAINT `fk_points_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `points_ledger`
--

LOCK TABLES `points_ledger` WRITE;
/*!40000 ALTER TABLE `points_ledger` DISABLE KEYS */;
/*!40000 ALTER TABLE `points_ledger` ENABLE KEYS */;
UNLOCK TABLES;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER `trg_points_ledger_no_update` BEFORE UPDATE ON `points_ledger` FOR EACH ROW BEGIN
        IF COALESCE(@mt_maintenance, 0) <> 1 THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'LEDGER_IMMUTABLE: points_ledger rows cannot be updated. Post a reversal entry instead.';
        END IF;
      END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER `trg_points_ledger_no_delete` BEFORE DELETE ON `points_ledger` FOR EACH ROW BEGIN
        IF COALESCE(@mt_maintenance, 0) <> 1 THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'LEDGER_IMMUTABLE: points_ledger rows cannot be deleted. Post a reversal entry instead.';
        END IF;
      END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;

--
-- Table structure for table `points_rules`
--

DROP TABLE IF EXISTS `points_rules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `points_rules` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `gameId` varchar(255) DEFAULT NULL,
  `action` varchar(64) NOT NULL,
  `points` int NOT NULL,
  `dailyCapPerUser` int NOT NULL DEFAULT '0',
  `enabled` tinyint NOT NULL DEFAULT '1',
  `version` int NOT NULL DEFAULT '1',
  `effectiveFrom` datetime(6) NOT NULL,
  `proposedById` varchar(255) DEFAULT NULL,
  `approvedById` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_rule_game_action` (`gameId`,`action`),
  CONSTRAINT `fk_rule_game` FOREIGN KEY (`gameId`) REFERENCES `games` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `points_rules`
--

LOCK TABLES `points_rules` WRITE;
/*!40000 ALTER TABLE `points_rules` DISABLE KEYS */;
/*!40000 ALTER TABLE `points_rules` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `quests`
--

DROP TABLE IF EXISTS `quests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `quests` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `title` varchar(160) NOT NULL,
  `description` text NOT NULL,
  `kind` enum('daily','weekly','milestone') NOT NULL,
  `gameId` varchar(255) DEFAULT NULL,
  `objective` json NOT NULL,
  `target` int NOT NULL,
  `rewardPoints` int NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  KEY `idx_quest_kind_active` (`kind`,`active`),
  KEY `fk_quest_game` (`gameId`),
  CONSTRAINT `fk_quest_game` FOREIGN KEY (`gameId`) REFERENCES `games` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `quests`
--

LOCK TABLES `quests` WRITE;
/*!40000 ALTER TABLE `quests` DISABLE KEYS */;
INSERT INTO `quests` (`id`, `createdAt`, `updatedAt`, `title`, `description`, `kind`, `gameId`, `objective`, `target`, `rewardPoints`, `active`) VALUES ('0bf218b9-70e0-4837-8dc8-0a696723378b','2026-08-24 08:21:04.550366','2026-08-24 08:21:04.550366','Enter two tournaments','Any entry type.','weekly',NULL,'{\"value\": 2, \"gameId\": null, \"metric\": \"tournaments\"}',2,1200,1),('0e8e09fd-eb36-4f36-8b16-d72342741de2','2026-08-24 08:21:04.543187','2026-08-24 08:21:04.543187','Earn 1,000 Points','Across any titles.','daily',NULL,'{\"value\": 1000, \"gameId\": null, \"metric\": \"points\"}',1000,150,1),('1d66888b-2cf4-42b5-b0f6-2472f35b085f','2026-08-24 08:21:04.561231','2026-08-24 08:21:04.561231','Refer ten active players','They must complete five sessions each.','milestone',NULL,'{\"value\": 10, \"gameId\": null, \"metric\": \"referrals\"}',10,3000,1),('4f854e5c-e68a-40a7-a6e9-d6816f21bb86','2026-08-24 08:21:04.546787','2026-08-24 08:21:04.546787','Win 10 ranked rounds','Cipher Break or Hex Tactics.','weekly',NULL,'{\"value\": 10, \"gameId\": null, \"metric\": \"wins\"}',10,1500,1),('a38f9636-1abf-42b7-8197-c8a6b5795e05','2026-08-24 08:21:04.539153','2026-08-24 08:21:04.539153','Score 5,000 in Neon Rush','Single run.','daily','875e749f-324a-41b6-a916-e240c8cd0bf3','{\"value\": 5000, \"gameId\": \"875e749f-324a-41b6-a916-e240c8cd0bf3\", \"metric\": \"score\"}',5000,400,1),('a7a8307d-d3cd-48b1-a23f-22e994fc6817','2026-08-24 08:21:04.554175','2026-08-24 08:21:04.554175','Play twenty sessions','Consistency beats intensity.','weekly',NULL,'{\"value\": 20, \"gameId\": null, \"metric\": \"sessions\"}',20,900,1),('b47a5cb5-20d2-4b7d-a2a1-319512eefb01','2026-08-24 08:21:04.557632','2026-08-24 08:21:04.557632','Convert 100,000 Points','Lifetime Points converted to MTT.','milestone',NULL,'{\"value\": 100000, \"gameId\": null, \"metric\": \"conversions\"}',100000,5000,1),('dfea9585-d5aa-4fd0-8dee-cda86ddc701c','2026-08-24 08:21:04.535467','2026-08-24 08:21:04.535467','Play three sessions','Any game. Free mode counts.','daily',NULL,'{\"value\": 3, \"gameId\": null, \"metric\": \"sessions\"}',3,250,1);
/*!40000 ALTER TABLE `quests` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `referral_edges`
--

DROP TABLE IF EXISTS `referral_edges`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `referral_edges` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `userId` varchar(255) NOT NULL,
  `ancestorId` varchar(255) NOT NULL,
  `level` tinyint NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_edge_user_ancestor` (`userId`,`ancestorId`),
  KEY `idx_edge_user` (`userId`),
  KEY `idx_edge_ancestor_level` (`ancestorId`,`level`),
  CONSTRAINT `fk_edge_ancestor` FOREIGN KEY (`ancestorId`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_edge_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `referral_edges`
--

LOCK TABLES `referral_edges` WRITE;
/*!40000 ALTER TABLE `referral_edges` DISABLE KEYS */;
/*!40000 ALTER TABLE `referral_edges` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `revenue_events`
--

DROP TABLE IF EXISTS `revenue_events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `revenue_events` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `ref` varchar(32) NOT NULL,
  `userId` varchar(255) NOT NULL,
  `stream` enum('iap','tournament','marketplace','advertising','subscription') NOT NULL,
  `grossAmount` decimal(20,2) NOT NULL DEFAULT '0.00',
  `netAmount` decimal(20,2) NOT NULL DEFAULT '0.00',
  `processorFee` decimal(20,2) NOT NULL DEFAULT '0.00',
  `currency` varchar(3) NOT NULL DEFAULT 'INR',
  `processor` varchar(60) DEFAULT NULL,
  `processorRef` varchar(128) DEFAULT NULL,
  `occurredAt` datetime(6) NOT NULL,
  `settledAt` datetime(6) DEFAULT NULL,
  `reconciled` tinyint NOT NULL DEFAULT '0',
  `commissionEligible` tinyint NOT NULL DEFAULT '0',
  `commissionProcessedAt` datetime(6) DEFAULT NULL,
  `reversedAt` datetime(6) DEFAULT NULL,
  `reversalReason` varchar(128) DEFAULT NULL,
  `metadata` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_c86e2f630884eb9315da516d41` (`ref`),
  UNIQUE KEY `uq_revenue_processor_ref` (`processor`,`processorRef`),
  KEY `idx_revenue_eligible` (`commissionEligible`,`commissionProcessedAt`),
  KEY `idx_revenue_stream_time` (`stream`,`occurredAt`),
  KEY `idx_revenue_user` (`userId`),
  KEY `idx_revenue_occurred` (`occurredAt`,`stream`),
  KEY `idx_revenue_reconciled_occurred` (`reconciled`,`occurredAt`),
  KEY `idx_revenue_user_reconciled` (`userId`,`reconciled`,`occurredAt`),
  CONSTRAINT `FK_a6418dbe80fbcc44f7caab9fd8f` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `revenue_events`
--

LOCK TABLES `revenue_events` WRITE;
/*!40000 ALTER TABLE `revenue_events` DISABLE KEYS */;
/*!40000 ALTER TABLE `revenue_events` ENABLE KEYS */;
UNLOCK TABLES;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER `trg_revenue_events_no_delete` BEFORE DELETE ON `revenue_events` FOR EACH ROW BEGIN
        IF COALESCE(@mt_maintenance, 0) <> 1 THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'AUDIT_IMMUTABLE: revenue_events cannot be deleted. Reverse instead.';
        END IF;
      END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;

--
-- Table structure for table `role_permissions`
--

DROP TABLE IF EXISTS `role_permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `role_permissions` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `role` varchar(40) NOT NULL,
  `module` varchar(60) NOT NULL,
  `canRead` tinyint NOT NULL DEFAULT '0',
  `canWrite` tinyint NOT NULL DEFAULT '0',
  `canApprove` tinyint NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_roleperm` (`role`,`module`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `role_permissions`
--

LOCK TABLES `role_permissions` WRITE;
/*!40000 ALTER TABLE `role_permissions` DISABLE KEYS */;
INSERT INTO `role_permissions` (`id`, `createdAt`, `updatedAt`, `role`, `module`, `canRead`, `canWrite`, `canApprove`) VALUES ('025a600a-1acf-40db-8cf4-b2882a1c35b8','2026-08-24 08:21:04.375472','2026-08-24 08:21:04.375472','compliance','reports',1,0,0),('0fc863a0-f533-48d3-8a9f-0390e937d24c','2026-08-24 08:21:04.402589','2026-08-24 08:21:04.402589','super_admin','treasury',1,1,1),('1454a8b1-61a5-4693-a68f-12f09f0e4b09','2026-08-24 08:21:04.367184','2026-08-24 08:21:04.367184','compliance','withdrawals',1,1,1),('17330642-1196-443f-bb6c-9d3574ede991','2026-08-24 08:21:04.389606','2026-08-24 08:21:04.389606','finance_admin','commission',1,1,0),('319aaf7d-1bac-4782-a5c1-4bdd2ed06679','2026-08-24 08:21:04.354576','2026-08-24 08:21:04.354576','support','kyc',1,0,0),('340f79c1-f61c-49a3-940e-bc0844c72e68','2026-08-24 08:21:04.399520','2026-08-24 08:21:04.399520','super_admin','members',1,1,1),('387824cb-cc4e-49f0-88ac-790cc57ceb89','2026-08-24 08:21:04.378914','2026-08-24 08:21:04.378914','compliance','legal',1,0,1),('48461d68-2a0b-48b4-ae4c-019ab252f405','2026-08-24 08:21:04.386124','2026-08-24 08:21:04.386124','finance_admin','conversion',1,1,0),('538fac7f-f9a9-4466-bdd2-75d699a46267','2026-08-24 08:21:04.370773','2026-08-24 08:21:04.370773','compliance','fraud',1,1,1),('6a623501-d335-4ca7-a05f-62485cdc3cf2','2026-08-24 08:21:04.382916','2026-08-24 08:21:04.382916','finance_admin','treasury',1,1,0),('7580073c-d756-41d3-a608-e14a437e76f1','2026-08-24 08:21:04.406069','2026-08-24 08:21:04.406069','super_admin','conversion',1,1,1),('7bb08604-c663-4519-81fa-8533e4c93d52','2026-08-24 08:21:04.409249','2026-08-24 08:21:04.409249','super_admin','commission',1,1,1),('7e4c832b-d291-4ced-a19e-c4ee0289c4ae','2026-08-24 08:21:04.393078','2026-08-24 08:21:04.393078','finance_admin','reports',1,1,0),('8c2fb557-13b0-40ba-9ddc-46ae82441698','2026-08-24 08:21:04.346181','2026-08-24 08:21:04.346181','support','members',1,0,0),('a414ac2c-edab-404e-be50-29643393f932','2026-08-24 08:21:04.412419','2026-08-24 08:21:04.412419','super_admin','withdrawals',1,1,1),('b7d34efc-b259-46ac-9c0d-b036e14df444','2026-08-24 08:21:04.350946','2026-08-24 08:21:04.350946','support','support',1,1,0),('bb8fa1ef-3b19-4990-bfce-9c7e6100ff6f','2026-08-24 08:21:04.419413','2026-08-24 08:21:04.419413','super_admin','legal',1,1,1),('bbd1edbe-a861-4570-b280-623c05fe1fb7','2026-08-24 08:21:04.431072','2026-08-24 08:21:04.431072','super_admin','reports',1,1,1),('bdb55354-2229-415c-b17d-9b6f71cb941d','2026-08-24 08:21:04.422932','2026-08-24 08:21:04.422932','super_admin','config',1,1,1),('d4d7191e-d2b7-4585-ae51-d3872d5a2584','2026-08-24 08:21:04.362984','2026-08-24 08:21:04.362984','compliance','kyc',1,1,1),('e80a4177-3072-4805-8495-6953f7cf7bee','2026-08-24 08:21:04.415609','2026-08-24 08:21:04.415609','super_admin','fraud',1,1,1),('ee4c0fe5-5333-4162-bf1b-add040ec3c3f','2026-08-24 08:21:04.396396','2026-08-24 08:21:04.396396','finance_admin','withdrawals',1,0,0),('fd4b7b06-6b66-424f-af43-791794ea0d2b','2026-08-24 08:21:04.358443','2026-08-24 08:21:04.358443','compliance','members',1,1,0);
/*!40000 ALTER TABLE `role_permissions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `staking_apr_history`
--

DROP TABLE IF EXISTS `staking_apr_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `staking_apr_history` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `poolId` int NOT NULL,
  `periodKey` varchar(10) NOT NULL,
  `apr` decimal(8,4) NOT NULL,
  `inflow` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `tvl` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_apr_pool_period` (`poolId`,`periodKey`),
  CONSTRAINT `fk_apr_pool` FOREIGN KEY (`poolId`) REFERENCES `staking_pools` (`poolId`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `staking_apr_history`
--

LOCK TABLES `staking_apr_history` WRITE;
/*!40000 ALTER TABLE `staking_apr_history` DISABLE KEYS */;
/*!40000 ALTER TABLE `staking_apr_history` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `staking_pools`
--

DROP TABLE IF EXISTS `staking_pools`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `staking_pools` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `poolId` int NOT NULL,
  `name` varchar(60) NOT NULL,
  `lockDays` int NOT NULL,
  `rewardsDurationDays` int NOT NULL,
  `earlyPenaltyBps` int NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `totalStaked` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `totalRewardsFunded` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `totalRewardsPaid` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `currentApr` decimal(8,4) NOT NULL DEFAULT '0.0000',
  `lastSyncedBlock` bigint DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pool_id` (`poolId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `staking_pools`
--

LOCK TABLES `staking_pools` WRITE;
/*!40000 ALTER TABLE `staking_pools` DISABLE KEYS */;
INSERT INTO `staking_pools` (`id`, `createdAt`, `updatedAt`, `poolId`, `name`, `lockDays`, `rewardsDurationDays`, `earlyPenaltyBps`, `active`, `totalStaked`, `totalRewardsFunded`, `totalRewardsPaid`, `currentApr`, `lastSyncedBlock`) VALUES ('04b8856a-54d6-4c28-aa24-8b63b66bd2c6','2026-08-24 08:21:04.499434','2026-08-24 08:21:04.499434',3,'180-Day',180,30,4000,1,0.000000000000000000,0.000000000000000000,0.000000000000000000,0.0000,NULL),('4a297f22-a150-4713-94c4-a1ac540c84f7','2026-08-24 08:21:04.496027','2026-08-24 08:21:04.496027',2,'90-Day',90,30,3000,1,0.000000000000000000,0.000000000000000000,0.000000000000000000,0.0000,NULL),('a4fab9ed-959a-4d10-a51b-dba53a44c5a4','2026-08-24 08:21:04.492190','2026-08-24 08:21:04.492190',1,'30-Day',30,30,2000,1,0.000000000000000000,0.000000000000000000,0.000000000000000000,0.0000,NULL),('f8c30a98-e2f8-4590-a908-bc1a2139b28c','2026-08-24 08:21:04.488108','2026-08-24 08:21:04.488108',0,'Flexible',0,7,0,1,0.000000000000000000,0.000000000000000000,0.000000000000000000,0.0000,NULL);
/*!40000 ALTER TABLE `staking_pools` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `staking_positions`
--

DROP TABLE IF EXISTS `staking_positions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `staking_positions` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `userId` varchar(255) NOT NULL,
  `poolId` int NOT NULL,
  `amount` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `lockEnd` datetime(6) DEFAULT NULL,
  `pendingRewards` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `stakedAt` datetime(6) DEFAULT NULL,
  `lastSyncedBlock` bigint DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_position_user_pool` (`userId`,`poolId`),
  KEY `idx_position_lockend` (`lockEnd`),
  KEY `fk_pos_pool` (`poolId`),
  CONSTRAINT `fk_pos_pool` FOREIGN KEY (`poolId`) REFERENCES `staking_pools` (`poolId`) ON DELETE RESTRICT,
  CONSTRAINT `fk_pos_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `staking_positions`
--

LOCK TABLES `staking_positions` WRITE;
/*!40000 ALTER TABLE `staking_positions` DISABLE KEYS */;
/*!40000 ALTER TABLE `staking_positions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `staking_rewards`
--

DROP TABLE IF EXISTS `staking_rewards`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `staking_rewards` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `ref` varchar(32) NOT NULL,
  `userId` varchar(255) NOT NULL,
  `poolId` int NOT NULL,
  `accrued` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `claimed` tinyint NOT NULL DEFAULT '0',
  `txHash` varchar(66) DEFAULT NULL,
  `periodKey` varchar(10) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_19752e92b9af8efc2a3e0213c8` (`ref`),
  KEY `idx_reward_user_time` (`userId`,`createdAt`),
  KEY `fk_reward_pool` (`poolId`),
  CONSTRAINT `fk_reward_pool` FOREIGN KEY (`poolId`) REFERENCES `staking_pools` (`poolId`) ON DELETE RESTRICT,
  CONSTRAINT `fk_reward_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `staking_rewards`
--

LOCK TABLES `staking_rewards` WRITE;
/*!40000 ALTER TABLE `staking_rewards` DISABLE KEYS */;
/*!40000 ALTER TABLE `staking_rewards` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `store_items`
--

DROP TABLE IF EXISTS `store_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `store_items` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `sku` varchar(64) NOT NULL,
  `name` varchar(160) NOT NULL,
  `description` text NOT NULL,
  `category` enum('cosmetic','boost','energy','pass') NOT NULL,
  `rarity` enum('common','rare','epic','legendary') NOT NULL DEFAULT 'common',
  `priceMtt` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `pricePoints` int DEFAULT NULL,
  `hue` int NOT NULL DEFAULT '24',
  `active` tinyint NOT NULL DEFAULT '1',
  `consumable` tinyint NOT NULL DEFAULT '0',
  `tradable` tinyint NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_c5ae2dbe1e2764f3aafd33a236` (`sku`),
  KEY `idx_item_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `store_items`
--

LOCK TABLES `store_items` WRITE;
/*!40000 ALTER TABLE `store_items` DISABLE KEYS */;
INSERT INTO `store_items` (`id`, `createdAt`, `updatedAt`, `sku`, `name`, `description`, `category`, `rarity`, `priceMtt`, `pricePoints`, `hue`, `active`, `consumable`, `tradable`) VALUES ('22e2988d-4c8f-4b77-901c-7c8343479eb6','2026-08-24 08:21:04.607782','2026-08-24 08:21:04.607782','BOOST-PTS-50','Points Boost +50%','Six hours of heavily boosted Points.','boost','rare',30.000000000000000000,26000,147,1,1,0),('29d9f421-16f7-47b1-a28a-38ef55cc4c8a','2026-08-24 08:21:04.600875','2026-08-24 08:21:04.600875','SKIN-HEX-01','Obsidian Hex Board','Board theme for Hex Tactics.','cosmetic','epic',120.000000000000000000,NULL,276,1,0,1),('3a40d8c0-7ab8-4db6-9ae9-c7d4ac3493d7','2026-08-24 08:21:04.594415','2026-08-24 08:21:04.594415','SKIN-NEON-01','Neon Circuit Skin','Animated trail for Neon Rush.','cosmetic','rare',45.000000000000000000,40000,24,1,0,1),('6db3ceae-d8fd-40e3-8bff-3cd49e4891ca','2026-08-24 08:21:04.604600','2026-08-24 08:21:04.604600','BOOST-PTS-20','Points Boost +20%','Twenty-four hours of boosted Points.','boost','common',15.000000000000000000,12000,104,1,1,0),('87aa9967-1011-4dfe-b216-f6b06cbffcec','2026-08-24 08:21:04.611342','2026-08-24 08:21:04.611342','ENERGY-05','Energy Refill ×5','Five extra paid-mode entries.','energy','common',10.000000000000000000,9000,190,1,1,0),('cf6f6e77-ab98-46be-8b69-715b7beaab92','2026-08-24 08:21:04.615019','2026-08-24 08:21:04.615019','PASS-SEASON-01','Season One Pass','Season rewards track and ranked access.','pass','legendary',250.000000000000000000,NULL,319,1,0,0);
/*!40000 ALTER TABLE `store_items` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `ticket_messages`
--

DROP TABLE IF EXISTS `ticket_messages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ticket_messages` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `ticketId` varchar(255) NOT NULL,
  `authorId` varchar(255) DEFAULT NULL,
  `authorRole` enum('user','agent','system') NOT NULL,
  `body` text NOT NULL,
  `internal` tinyint NOT NULL DEFAULT '0',
  `attachments` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_msg_ticket` (`ticketId`,`createdAt`),
  CONSTRAINT `fk_msg_ticket` FOREIGN KEY (`ticketId`) REFERENCES `tickets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `ticket_messages`
--

LOCK TABLES `ticket_messages` WRITE;
/*!40000 ALTER TABLE `ticket_messages` DISABLE KEYS */;
/*!40000 ALTER TABLE `ticket_messages` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `tickets`
--

DROP TABLE IF EXISTS `tickets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tickets` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `ref` varchar(32) NOT NULL,
  `userId` varchar(255) NOT NULL,
  `subject` varchar(200) NOT NULL,
  `category` enum('account','kyc','withdrawal','commission','gameplay','technical','other') NOT NULL,
  `status` enum('open','pending_user','escalated','resolved','closed') NOT NULL DEFAULT 'open',
  `priority` enum('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
  `financialDispute` tinyint NOT NULL DEFAULT '0',
  `assigneeId` varchar(255) DEFAULT NULL,
  `slaDueAt` datetime(6) NOT NULL,
  `firstResponseAt` datetime(6) DEFAULT NULL,
  `resolvedAt` datetime(6) DEFAULT NULL,
  `satisfactionRating` int DEFAULT NULL,
  `disputedRef` varchar(64) DEFAULT NULL,
  `mergedIntoId` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_16c94a2869ed147f95eb941adc` (`ref`),
  KEY `idx_ticket_sla` (`slaDueAt`),
  KEY `idx_ticket_user` (`userId`),
  KEY `idx_ticket_status` (`status`),
  CONSTRAINT `fk_ticket_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tickets`
--

LOCK TABLES `tickets` WRITE;
/*!40000 ALTER TABLE `tickets` DISABLE KEYS */;
/*!40000 ALTER TABLE `tickets` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `tournament_entries`
--

DROP TABLE IF EXISTS `tournament_entries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tournament_entries` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `tournamentId` varchar(255) NOT NULL,
  `userId` varchar(255) NOT NULL,
  `paidAmount` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `revenueEventId` varchar(255) DEFAULT NULL,
  `bestScore` int DEFAULT NULL,
  `rank` int DEFAULT NULL,
  `prizeAmount` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `prizePaidAt` datetime(6) DEFAULT NULL,
  `disqualified` tinyint NOT NULL DEFAULT '0',
  `disqualificationReason` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_entry_tournament_user` (`tournamentId`,`userId`),
  KEY `idx_entry_user` (`userId`),
  CONSTRAINT `fk_entry_tournament` FOREIGN KEY (`tournamentId`) REFERENCES `tournaments` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_entry_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tournament_entries`
--

LOCK TABLES `tournament_entries` WRITE;
/*!40000 ALTER TABLE `tournament_entries` DISABLE KEYS */;
/*!40000 ALTER TABLE `tournament_entries` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `tournaments`
--

DROP TABLE IF EXISTS `tournaments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tournaments` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `ref` varchar(32) NOT NULL,
  `gameId` varchar(255) NOT NULL,
  `name` varchar(160) NOT NULL,
  `startsAt` datetime(6) NOT NULL,
  `endsAt` datetime(6) NOT NULL,
  `entryFee` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `prizePool` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `participants` int NOT NULL DEFAULT '0',
  `maxParticipants` int NOT NULL DEFAULT '1000',
  `status` enum('draft','scheduled','live','completed','cancelled') NOT NULL DEFAULT 'draft',
  `format` varchar(200) NOT NULL,
  `prizeSplit` json NOT NULL,
  `prizeSplitLockedAt` datetime(6) DEFAULT NULL,
  `rules` text,
  `settledAt` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_df5d8eb38fdbfbe791905445cf` (`ref`),
  KEY `idx_tournament_status_start` (`status`,`startsAt`),
  KEY `fk_tournament_game` (`gameId`),
  CONSTRAINT `fk_tournament_game` FOREIGN KEY (`gameId`) REFERENCES `games` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tournaments`
--

LOCK TABLES `tournaments` WRITE;
/*!40000 ALTER TABLE `tournaments` DISABLE KEYS */;
/*!40000 ALTER TABLE `tournaments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `transactions`
--

DROP TABLE IF EXISTS `transactions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `transactions` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `ref` varchar(32) NOT NULL,
  `userId` varchar(255) NOT NULL,
  `type` enum('conversion','stake','unstake','reward_claim','commission_claim','deposit','withdrawal','store_purchase','marketplace_sale','marketplace_purchase','tournament_entry','prize_payout','clawback','admin_adjustment') NOT NULL,
  `amountMtt` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `amountFiat` decimal(20,2) DEFAULT NULL,
  `currency` varchar(3) DEFAULT NULL,
  `status` enum('pending','queued','processing','review','completed','failed','cancelled') NOT NULL DEFAULT 'pending',
  `sourceTag` enum('gameplay','staking','referral','deposit','prize') DEFAULT NULL,
  `txHash` varchar(66) DEFAULT NULL,
  `chainId` int DEFAULT NULL,
  `blockNumber` bigint DEFAULT NULL,
  `note` varchar(255) DEFAULT NULL,
  `failureReason` text,
  `metadata` json DEFAULT NULL,
  `idempotencyKey` varchar(128) NOT NULL,
  `settledAt` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_edd2f70623061e40c3f67ce7f5` (`ref`),
  UNIQUE KEY `uq_tx_idem` (`idempotencyKey`),
  KEY `idx_tx_hash` (`txHash`),
  KEY `idx_tx_type_status` (`type`,`status`),
  KEY `idx_tx_user_time` (`userId`,`createdAt`),
  CONSTRAINT `FK_6bb58f2b6e30cb51a6504599f41` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `transactions`
--

LOCK TABLES `transactions` WRITE;
/*!40000 ALTER TABLE `transactions` DISABLE KEYS */;
/*!40000 ALTER TABLE `transactions` ENABLE KEYS */;
UNLOCK TABLES;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER `trg_transactions_no_delete` BEFORE DELETE ON `transactions` FOR EACH ROW BEGIN
        IF COALESCE(@mt_maintenance, 0) <> 1 THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'AUDIT_IMMUTABLE: transactions cannot be deleted.';
        END IF;
      END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;

--
-- Table structure for table `treasury_inflows`
--

DROP TABLE IF EXISTS `treasury_inflows`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `treasury_inflows` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `ref` varchar(32) NOT NULL,
  `revenueEventId` varchar(255) DEFAULT NULL,
  `stream` enum('iap','tournament','marketplace','advertising','subscription') NOT NULL,
  `grossRevenue` decimal(20,2) NOT NULL DEFAULT '0.00',
  `allocationBps` int NOT NULL,
  `amountToTreasury` decimal(20,2) NOT NULL DEFAULT '0.00',
  `amountMtt` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `processorRef` varchar(128) DEFAULT NULL,
  `reconciled` tinyint NOT NULL DEFAULT '0',
  `reconciledById` varchar(255) DEFAULT NULL,
  `reconciledAt` datetime(6) DEFAULT NULL,
  `reconciliationNote` text,
  `periodKey` varchar(10) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_69da46dfa0f3c35e72ec65036f` (`ref`),
  KEY `idx_inflow_reconciled` (`reconciled`),
  KEY `idx_inflow_period` (`periodKey`),
  KEY `idx_inflow_period_reconciled` (`periodKey`,`reconciled`),
  KEY `fk_inflow_revenue` (`revenueEventId`),
  CONSTRAINT `fk_inflow_revenue` FOREIGN KEY (`revenueEventId`) REFERENCES `revenue_events` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `treasury_inflows`
--

LOCK TABLES `treasury_inflows` WRITE;
/*!40000 ALTER TABLE `treasury_inflows` DISABLE KEYS */;
/*!40000 ALTER TABLE `treasury_inflows` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `treasury_outflows`
--

DROP TABLE IF EXISTS `treasury_outflows`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `treasury_outflows` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `ref` varchar(32) NOT NULL,
  `destination` enum('staking_pool','commission_pool') NOT NULL,
  `poolId` int DEFAULT NULL,
  `amount` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `status` enum('proposed','approved','submitted','confirmed','failed','rejected') NOT NULL DEFAULT 'proposed',
  `proposedById` varchar(255) NOT NULL,
  `approvedByIds` json DEFAULT NULL,
  `approvedAt` datetime(6) DEFAULT NULL,
  `txHash` varchar(66) DEFAULT NULL,
  `blockNumber` bigint DEFAULT NULL,
  `headroomAtApproval` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `fromReserve` tinyint NOT NULL DEFAULT '0',
  `rationale` text,
  `failureReason` text,
  `periodKey` varchar(10) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_f2d16dc6479023f77f5b91d799` (`ref`),
  KEY `idx_outflow_status` (`status`),
  KEY `idx_outflow_period` (`periodKey`),
  KEY `idx_outflow_period_status_dest` (`periodKey`,`status`,`destination`,`fromReserve`),
  KEY `idx_outflow_created` (`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `treasury_outflows`
--

LOCK TABLES `treasury_outflows` WRITE;
/*!40000 ALTER TABLE `treasury_outflows` DISABLE KEYS */;
/*!40000 ALTER TABLE `treasury_outflows` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `treasury_periods`
--

DROP TABLE IF EXISTS `treasury_periods`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `treasury_periods` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `periodKey` varchar(10) NOT NULL,
  `grossRevenue` decimal(20,2) NOT NULL DEFAULT '0.00',
  `reconciledInflow` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `unreconciledInflow` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `commissionOutflow` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `stakingOutflow` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `reserveFunded` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `payoutRatioBps` int NOT NULL DEFAULT '0',
  `realRevenueFundedBps` int NOT NULL DEFAULT '0',
  `computedAt` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_treasury_period` (`periodKey`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `treasury_periods`
--

LOCK TABLES `treasury_periods` WRITE;
/*!40000 ALTER TABLE `treasury_periods` DISABLE KEYS */;
/*!40000 ALTER TABLE `treasury_periods` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `user_achievements`
--

DROP TABLE IF EXISTS `user_achievements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_achievements` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `userId` varchar(255) NOT NULL,
  `achievementId` varchar(255) NOT NULL,
  `unlockedAt` datetime(6) NOT NULL,
  `pointsAwarded` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_userach` (`userId`,`achievementId`),
  KEY `fk_userach_ach` (`achievementId`),
  CONSTRAINT `fk_userach_ach` FOREIGN KEY (`achievementId`) REFERENCES `achievements` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_userach_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_achievements`
--

LOCK TABLES `user_achievements` WRITE;
/*!40000 ALTER TABLE `user_achievements` DISABLE KEYS */;
/*!40000 ALTER TABLE `user_achievements` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `user_balances`
--

DROP TABLE IF EXISTS `user_balances`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_balances` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `version` int NOT NULL,
  `userId` varchar(255) NOT NULL,
  `points` bigint NOT NULL DEFAULT '0',
  `mttAvailable` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `mttStaked` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `mttPendingRewards` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `commissionPending` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `commissionAvailable` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `commissionLifetime` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `mttLockedForWithdrawal` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `lastLedgerAt` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_fc961fea2e90ea93847e43f7b4` (`userId`),
  UNIQUE KEY `REL_fc961fea2e90ea93847e43f7b4` (`userId`),
  CONSTRAINT `FK_fc961fea2e90ea93847e43f7b4e` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_balances`
--

LOCK TABLES `user_balances` WRITE;
/*!40000 ALTER TABLE `user_balances` DISABLE KEYS */;
INSERT INTO `user_balances` (`id`, `createdAt`, `updatedAt`, `version`, `userId`, `points`, `mttAvailable`, `mttStaked`, `mttPendingRewards`, `commissionPending`, `commissionAvailable`, `commissionLifetime`, `mttLockedForWithdrawal`, `lastLedgerAt`) VALUES ('0c901e70-fc9c-4a0b-95fb-adfae5213c7f','2026-08-24 08:21:04.338242','2026-08-24 08:21:04.338242',1,'ba11a375-3ddf-4672-a20b-662741f8aec2',0,0.000000000000000000,0.000000000000000000,0.000000000000000000,0.000000000000000000,0.000000000000000000,0.000000000000000000,0.000000000000000000,NULL),('116234b8-f0e8-45ed-b548-46447e2b9cf2','2026-08-24 08:21:04.169892','2026-08-24 08:21:04.169892',1,'ef59688c-7ab0-4bc8-8f92-0a59cd725e43',0,0.000000000000000000,0.000000000000000000,0.000000000000000000,0.000000000000000000,0.000000000000000000,0.000000000000000000,0.000000000000000000,NULL),('300cfd0e-e7f1-4056-83c8-e939139c7da0','2026-08-24 08:21:04.240060','2026-08-24 08:21:04.240060',1,'0cb3337b-47ac-4d1c-aeef-7aaee06f2a6c',0,0.000000000000000000,0.000000000000000000,0.000000000000000000,0.000000000000000000,0.000000000000000000,0.000000000000000000,0.000000000000000000,NULL),('7667087d-3afd-4560-8817-4d428551ead0','2026-08-24 08:21:04.294154','2026-08-24 08:21:04.294154',1,'eb013524-5668-4248-9b42-2af536f5f7ab',0,0.000000000000000000,0.000000000000000000,0.000000000000000000,0.000000000000000000,0.000000000000000000,0.000000000000000000,0.000000000000000000,NULL);
/*!40000 ALTER TABLE `user_balances` ENABLE KEYS */;
UNLOCK TABLES;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER `trg_balance_no_negative_insert` BEFORE INSERT ON `user_balances` FOR EACH ROW BEGIN
        IF NEW.points < 0 OR NEW.mttAvailable < 0 OR NEW.mttStaked < 0
           OR NEW.mttPendingRewards < 0 OR NEW.commissionPending < 0
           OR NEW.commissionAvailable < 0 OR NEW.mttLockedForWithdrawal < 0 THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'BALANCE_NEGATIVE: a balance bucket cannot be negative.';
        END IF;
      END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER `trg_balance_no_negative_update` BEFORE UPDATE ON `user_balances` FOR EACH ROW BEGIN
        IF NEW.points < 0 OR NEW.mttAvailable < 0 OR NEW.mttStaked < 0
           OR NEW.mttPendingRewards < 0 OR NEW.commissionPending < 0
           OR NEW.commissionAvailable < 0 OR NEW.mttLockedForWithdrawal < 0 THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'BALANCE_NEGATIVE: a balance bucket cannot be negative.';
        END IF;
        -- Lifetime commission only ever grows. A clawback reduces what is claimable,
        -- never what was historically earned, and the distinction is what makes the
        -- figure meaningful.
        IF NEW.commissionLifetime < OLD.commissionLifetime THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'LIFETIME_DECREASE: commissionLifetime cannot decrease.';
        END IF;
      END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;

--
-- Table structure for table `user_inventory`
--

DROP TABLE IF EXISTS `user_inventory`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_inventory` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `userId` varchar(255) NOT NULL,
  `itemId` varchar(255) NOT NULL,
  `quantity` int NOT NULL DEFAULT '1',
  `consumedAt` datetime(6) DEFAULT NULL,
  `expiresAt` datetime(6) DEFAULT NULL,
  `lockedByListingId` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_inv_user` (`userId`),
  KEY `fk_inv_item` (`itemId`),
  CONSTRAINT `fk_inv_item` FOREIGN KEY (`itemId`) REFERENCES `store_items` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_inv_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_inventory`
--

LOCK TABLES `user_inventory` WRITE;
/*!40000 ALTER TABLE `user_inventory` DISABLE KEYS */;
/*!40000 ALTER TABLE `user_inventory` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `user_quests`
--

DROP TABLE IF EXISTS `user_quests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_quests` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `userId` varchar(255) NOT NULL,
  `questId` varchar(255) NOT NULL,
  `periodKey` varchar(16) NOT NULL,
  `progress` int NOT NULL DEFAULT '0',
  `completedAt` datetime(6) DEFAULT NULL,
  `claimedAt` datetime(6) DEFAULT NULL,
  `pointsAwarded` int NOT NULL DEFAULT '0',
  `expiresAt` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_userquest_period` (`userId`,`questId`,`periodKey`),
  KEY `idx_userquest_user` (`userId`),
  KEY `idx_userquest_expires` (`expiresAt`,`claimedAt`),
  KEY `fk_userquest_quest` (`questId`),
  CONSTRAINT `fk_userquest_quest` FOREIGN KEY (`questId`) REFERENCES `quests` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_userquest_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_quests`
--

LOCK TABLES `user_quests` WRITE;
/*!40000 ALTER TABLE `user_quests` DISABLE KEYS */;
/*!40000 ALTER TABLE `user_quests` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `user_sessions`
--

DROP TABLE IF EXISTS `user_sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_sessions` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `userId` varchar(255) NOT NULL,
  `jti` varchar(64) NOT NULL,
  `refreshTokenHash` varchar(64) NOT NULL,
  `replacedByHash` varchar(64) DEFAULT NULL,
  `device` varchar(200) DEFAULT NULL,
  `ip` varchar(45) DEFAULT NULL,
  `userAgent` varchar(400) DEFAULT NULL,
  `location` varchar(120) DEFAULT NULL,
  `expiresAt` datetime(6) NOT NULL,
  `lastActiveAt` datetime(6) DEFAULT NULL,
  `revokedAt` datetime(6) DEFAULT NULL,
  `revokedReason` varchar(64) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_705c76591465aa6943b60551cd` (`jti`),
  KEY `idx_sessions_refresh` (`refreshTokenHash`),
  KEY `idx_sessions_expires` (`expiresAt`),
  KEY `idx_sessions_user` (`userId`),
  CONSTRAINT `FK_55fa4db8406ed66bc7044328427` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_sessions`
--

LOCK TABLES `user_sessions` WRITE;
/*!40000 ALTER TABLE `user_sessions` DISABLE KEYS */;
/*!40000 ALTER TABLE `user_sessions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `deletedAt` datetime(6) DEFAULT NULL,
  `ref` varchar(32) NOT NULL,
  `email` varchar(320) NOT NULL,
  `emailHash` varchar(64) NOT NULL,
  `emailVerifiedAt` datetime(6) DEFAULT NULL,
  `phone` varchar(32) DEFAULT NULL,
  `phoneHash` varchar(64) DEFAULT NULL,
  `phoneVerifiedAt` datetime(6) DEFAULT NULL,
  `passwordHash` varchar(255) NOT NULL,
  `passwordChangedAt` datetime(6) DEFAULT NULL,
  `twoFaMethod` enum('none','sms','totp') NOT NULL DEFAULT 'none',
  `twoFaSecretEnc` text,
  `twoFaEnabledAt` datetime(6) DEFAULT NULL,
  `twoFaRecoveryCodes` json DEFAULT NULL,
  `fullName` varchar(160) NOT NULL,
  `displayName` varchar(60) NOT NULL,
  `avatarUrl` varchar(512) DEFAULT NULL,
  `dateOfBirth` date DEFAULT NULL,
  `country` varchar(2) NOT NULL,
  `locale` varchar(8) NOT NULL DEFAULT 'en',
  `timezone` varchar(64) NOT NULL DEFAULT 'UTC',
  `status` enum('pending_verification','verified_kyc_pending','active','suspended','frozen','closed') NOT NULL DEFAULT 'pending_verification',
  `kycTier` tinyint NOT NULL DEFAULT '0',
  `role` enum('player','support','compliance','finance_admin','super_admin') NOT NULL DEFAULT 'player',
  `isStaff` tinyint NOT NULL DEFAULT '0',
  `statusReason` text,
  `walletAddress` varchar(42) DEFAULT NULL,
  `walletType` enum('external','custodial') DEFAULT NULL,
  `walletLockedAt` datetime(6) DEFAULT NULL,
  `referralCode` varchar(32) NOT NULL,
  `referredById` varchar(255) DEFAULT NULL,
  `sponsorPath` varchar(512) DEFAULT NULL,
  `referralDepth` int NOT NULL DEFAULT '0',
  `riskScore` int NOT NULL DEFAULT '0',
  `riskFlags` json DEFAULT NULL,
  `signupFingerprint` varchar(128) DEFAULT NULL,
  `signupIp` varchar(45) DEFAULT NULL,
  `lastActiveAt` datetime(6) DEFAULT NULL,
  `lastLoginAt` datetime(6) DEFAULT NULL,
  `gameSessionCount` int NOT NULL DEFAULT '0',
  `acceptedLegalVersions` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_1e4459389a3c9d0b8dbb7a4b13` (`ref`),
  UNIQUE KEY `IDX_9e8fe0cd68634a2dc2fd7d1712` (`emailHash`),
  UNIQUE KEY `IDX_b7f8278f4e89249bb75c9a1589` (`referralCode`),
  UNIQUE KEY `IDX_a78fbf9a44244abda9841b8dc2` (`phoneHash`),
  KEY `idx_users_wallet` (`walletAddress`),
  KEY `idx_users_sponsor_path` (`sponsorPath`),
  KEY `idx_users_signup_fp` (`signupFingerprint`),
  KEY `idx_users_signup_ip` (`signupIp`),
  KEY `idx_users_created` (`createdAt`),
  KEY `idx_users_risk` (`riskScore`),
  KEY `idx_users_referred_by` (`referredById`),
  KEY `idx_users_kyc` (`kycTier`),
  KEY `idx_users_status` (`status`),
  KEY `idx_users_last_active` (`lastActiveAt`),
  CONSTRAINT `FK_1142607b5a447cd5ce23ef7798f` FOREIGN KEY (`referredById`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` (`id`, `createdAt`, `updatedAt`, `deletedAt`, `ref`, `email`, `emailHash`, `emailVerifiedAt`, `phone`, `phoneHash`, `phoneVerifiedAt`, `passwordHash`, `passwordChangedAt`, `twoFaMethod`, `twoFaSecretEnc`, `twoFaEnabledAt`, `twoFaRecoveryCodes`, `fullName`, `displayName`, `avatarUrl`, `dateOfBirth`, `country`, `locale`, `timezone`, `status`, `kycTier`, `role`, `isStaff`, `statusReason`, `walletAddress`, `walletType`, `walletLockedAt`, `referralCode`, `referredById`, `sponsorPath`, `referralDepth`, `riskScore`, `riskFlags`, `signupFingerprint`, `signupIp`, `lastActiveAt`, `lastLoginAt`, `gameSessionCount`, `acceptedLegalVersions`) VALUES ('0cb3337b-47ac-4d1c-aeef-7aaee06f2a6c','2026-08-24 08:21:04.234446','2026-08-24 08:21:04.234446',NULL,'USR-Z55X83C5','compliance@memberstrail.local','82ed1ae87acc3a7683603b9acf65acf164e055a5408c743c70e01f5982a9dfc5','2026-08-24 08:21:04.181000',NULL,NULL,NULL,'$argon2id$v=19$m=19456,t=2,p=1$RbezCpwONR9lU/7y6L09OA$qoW9VMyKiOFDah5oHyoDDmoPlK1ZG3eAL+TpzzlvaKA','2026-08-24 08:21:04.229000','none',NULL,NULL,NULL,'Compliance Desk','Compliance',NULL,NULL,'IN','en','UTC','active',0,'compliance',1,NULL,NULL,NULL,NULL,'OPS-9TA92H',NULL,NULL,0,0,NULL,NULL,NULL,NULL,NULL,0,'{\"seededAt\": \"2026-08-24T08:21:04.229Z\"}'),('ba11a375-3ddf-4672-a20b-662741f8aec2','2026-08-24 08:21:04.333727','2026-08-24 08:21:04.333727',NULL,'USR-QDUEGN27','support@memberstrail.local','6ec427d39c0ddfbe8557611a66be30a167665cd787f0ec47adae8ae940621fa5','2026-08-24 08:21:04.300000',NULL,NULL,NULL,'$argon2id$v=19$m=19456,t=2,p=1$h2r7K/O83Qk28bDATkm8yg$3E+c2Ja4O9Ez9F2GdTkOjHTZ64IP1qt5RHlPA277VBI','2026-08-24 08:21:04.331000','none',NULL,NULL,NULL,'Support Desk','Support',NULL,NULL,'IN','en','UTC','active',0,'support',1,NULL,NULL,NULL,NULL,'OPS-RDHSLK',NULL,NULL,0,0,NULL,NULL,NULL,NULL,NULL,0,'{\"seededAt\": \"2026-08-24T08:21:04.331Z\"}'),('eb013524-5668-4248-9b42-2af536f5f7ab','2026-08-24 08:21:04.290034','2026-08-24 08:21:04.290034',NULL,'USR-JGUG86U6','finance@memberstrail.local','2297ed584d1c204ea1da29ba7e5625157564a1417e0698b30534f7afeb4dfca2','2026-08-24 08:21:04.250000',NULL,NULL,NULL,'$argon2id$v=19$m=19456,t=2,p=1$qoFUWrG0na9YebPAcMKEfA$vKthFSrFIPqyQhlEjmEUS+cag3kfQ5YaeVQr/xdpbjE','2026-08-24 08:21:04.287000','none',NULL,NULL,NULL,'Finance Desk','Finance',NULL,NULL,'IN','en','UTC','active',0,'finance_admin',1,NULL,NULL,NULL,NULL,'OPS-K8VSEE',NULL,NULL,0,0,NULL,NULL,NULL,NULL,NULL,0,'{\"seededAt\": \"2026-08-24T08:21:04.288Z\"}'),('ef59688c-7ab0-4bc8-8f92-0a59cd725e43','2026-08-24 08:21:04.161447','2026-08-24 08:21:04.161447',NULL,'USR-ZB1HSX5L','ops@memberstrail.local','db8f2c19b3ca264e34c85affad9db96ab9224961484d7286cf8276657086e8ee','2026-08-24 08:21:04.092000',NULL,NULL,NULL,'$argon2id$v=19$m=19456,t=2,p=1$AnbEUdCQlmfkQGm/BrJBEQ$tG+16V6Nl/EnRWi+N/2dXGkVfawgUt6C4TCSm72p3kw','2026-08-24 08:21:04.152000','none',NULL,NULL,NULL,'Platform Operations','Platform',NULL,NULL,'IN','en','UTC','active',0,'super_admin',1,NULL,NULL,NULL,NULL,'OPS-NUEL8A',NULL,NULL,0,0,NULL,NULL,NULL,NULL,NULL,0,'{\"seededAt\": \"2026-08-24T08:21:04.152Z\"}');
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Temporary view structure for view `v_admin_kpis`
--

DROP TABLE IF EXISTS `v_admin_kpis`;
/*!50001 DROP VIEW IF EXISTS `v_admin_kpis`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_admin_kpis` AS SELECT 
 1 AS `members`,
 1 AS `activeMembers30d`,
 1 AS `kycVerified`,
 1 AS `frozenAccounts`,
 1 AS `withdrawalsInReview`,
 1 AS `openFraudAlerts`,
 1 AS `pendingApprovals`,
 1 AS `breachedTickets`,
 1 AS `queuedCommissionMtt`*/;
SET character_set_client = @saved_cs_client;

--
-- Temporary view structure for view `v_commission_solvency`
--

DROP TABLE IF EXISTS `v_commission_solvency`;
/*!50001 DROP VIEW IF EXISTS `v_commission_solvency`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_commission_solvency` AS SELECT 
 1 AS `poolFundedMtt`,
 1 AS `committedMtt`,
 1 AS `queuedMtt`,
 1 AS `pendingKycMtt`*/;
SET character_set_client = @saved_cs_client;

--
-- Temporary view structure for view `v_conversion_monthly`
--

DROP TABLE IF EXISTS `v_conversion_monthly`;
/*!50001 DROP VIEW IF EXISTS `v_conversion_monthly`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_conversion_monthly` AS SELECT 
 1 AS `periodKey`,
 1 AS `rateApplied`,
 1 AS `conversions`,
 1 AS `pointsSpent`,
 1 AS `mttCredited`*/;
SET character_set_client = @saved_cs_client;

--
-- Temporary view structure for view `v_member_signup_cohort`
--

DROP TABLE IF EXISTS `v_member_signup_cohort`;
/*!50001 DROP VIEW IF EXISTS `v_member_signup_cohort`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_member_signup_cohort` AS SELECT 
 1 AS `periodKey`,
 1 AS `signups`,
 1 AS `verified`,
 1 AS `referred`,
 1 AS `closed`*/;
SET character_set_client = @saved_cs_client;

--
-- Temporary view structure for view `v_mtt_liability`
--

DROP TABLE IF EXISTS `v_mtt_liability`;
/*!50001 DROP VIEW IF EXISTS `v_mtt_liability`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_mtt_liability` AS SELECT 
 1 AS `accounts`,
 1 AS `availableMtt`,
 1 AS `stakedMtt`,
 1 AS `pendingRewardsMtt`,
 1 AS `lockedForWithdrawalMtt`,
 1 AS `commissionAvailableMtt`,
 1 AS `commissionPendingMtt`,
 1 AS `totalLiabilityMtt`,
 1 AS `totalPoints`*/;
SET character_set_client = @saved_cs_client;

--
-- Temporary view structure for view `v_payout_ratio`
--

DROP TABLE IF EXISTS `v_payout_ratio`;
/*!50001 DROP VIEW IF EXISTS `v_payout_ratio`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_payout_ratio` AS SELECT 
 1 AS `periodKey`,
 1 AS `reconciledNetRevenue`,
 1 AS `releasedCommission`,
 1 AS `confirmedOutflow`,
 1 AS `reconciledTreasuryInflow`,
 1 AS `commissionRatioBps`,
 1 AS `outflowRatioBps`*/;
SET character_set_client = @saved_cs_client;

--
-- Temporary view structure for view `v_points_drift`
--

DROP TABLE IF EXISTS `v_points_drift`;
/*!50001 DROP VIEW IF EXISTS `v_points_drift`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_points_drift` AS SELECT 
 1 AS `userId`,
 1 AS `balancePoints`,
 1 AS `ledgerPoints`,
 1 AS `drift`*/;
SET character_set_client = @saved_cs_client;

--
-- Temporary view structure for view `v_treasury_period`
--

DROP TABLE IF EXISTS `v_treasury_period`;
/*!50001 DROP VIEW IF EXISTS `v_treasury_period`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_treasury_period` AS SELECT 
 1 AS `periodKey`,
 1 AS `reconciledInflow`,
 1 AS `unreconciledInflow`,
 1 AS `grossRevenue`,
 1 AS `commissionPoolOut`,
 1 AS `stakingPoolOut`,
 1 AS `reserveOut`,
 1 AS `inflowCount`,
 1 AS `outflowCount`*/;
SET character_set_client = @saved_cs_client;

--
-- Table structure for table `verification_tokens`
--

DROP TABLE IF EXISTS `verification_tokens`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `verification_tokens` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `userId` varchar(255) DEFAULT NULL,
  `purpose` enum('email_verify','phone_verify','password_reset','wallet_link','email_change','two_fa') NOT NULL,
  `tokenHash` varchar(64) NOT NULL,
  `target` varchar(320) DEFAULT NULL,
  `attempts` int NOT NULL DEFAULT '0',
  `expiresAt` datetime(6) NOT NULL,
  `consumedAt` datetime(6) DEFAULT NULL,
  `requestedIp` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_verif_purpose_hash` (`purpose`,`tokenHash`),
  KEY `idx_verif_expires` (`expiresAt`),
  KEY `idx_verif_user` (`userId`,`purpose`),
  CONSTRAINT `fk_verif_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `verification_tokens`
--

LOCK TABLES `verification_tokens` WRITE;
/*!40000 ALTER TABLE `verification_tokens` DISABLE KEYS */;
/*!40000 ALTER TABLE `verification_tokens` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `wallet_addresses`
--

DROP TABLE IF EXISTS `wallet_addresses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wallet_addresses` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `userId` varchar(255) NOT NULL,
  `address` varchar(42) NOT NULL,
  `type` enum('external','custodial') NOT NULL,
  `isPrimary` tinyint NOT NULL DEFAULT '0',
  `verifiedAt` datetime(6) DEFAULT NULL,
  `whitelistedAt` datetime(6) DEFAULT NULL,
  `firstUsedAt` datetime(6) DEFAULT NULL,
  `label` varchar(64) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_wallet_user_address` (`userId`,`address`),
  KEY `idx_wallet_address` (`address`),
  CONSTRAINT `fk_wallet_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `wallet_addresses`
--

LOCK TABLES `wallet_addresses` WRITE;
/*!40000 ALTER TABLE `wallet_addresses` DISABLE KEYS */;
/*!40000 ALTER TABLE `wallet_addresses` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `webhook_events`
--

DROP TABLE IF EXISTS `webhook_events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `webhook_events` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `provider` varchar(60) NOT NULL,
  `eventId` varchar(191) NOT NULL,
  `eventType` varchar(120) DEFAULT NULL,
  `payload` json NOT NULL,
  `signatureValid` tinyint NOT NULL,
  `processedAt` datetime(6) DEFAULT NULL,
  `attempts` int NOT NULL DEFAULT '0',
  `error` text,
  `sourceIp` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_webhook_provider_event` (`provider`,`eventId`),
  KEY `idx_webhook_processed` (`processedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `webhook_events`
--

LOCK TABLES `webhook_events` WRITE;
/*!40000 ALTER TABLE `webhook_events` DISABLE KEYS */;
/*!40000 ALTER TABLE `webhook_events` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `withdrawals`
--

DROP TABLE IF EXISTS `withdrawals`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `withdrawals` (
  `id` varchar(36) NOT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `ref` varchar(32) NOT NULL,
  `userId` varchar(255) NOT NULL,
  `kind` enum('mtt','fiat') NOT NULL,
  `amountMtt` decimal(36,18) NOT NULL DEFAULT '0.000000000000000000',
  `amountFiat` decimal(20,2) DEFAULT NULL,
  `destination` text NOT NULL,
  `destinationAddress` varchar(42) DEFAULT NULL,
  `sourceTag` enum('gameplay','staking','referral','deposit','prize') NOT NULL,
  `status` enum('pending','cooling_off','review','approved','processing','completed','rejected','cancelled','failed') NOT NULL DEFAULT 'pending',
  `kycTierAtRequest` tinyint NOT NULL,
  `reviewRequired` tinyint NOT NULL DEFAULT '0',
  `coolingOffUntil` datetime(6) DEFAULT NULL,
  `reviewedById` varchar(255) DEFAULT NULL,
  `reviewedAt` datetime(6) DEFAULT NULL,
  `reviewNotes` text,
  `rejectionReason` text,
  `txHash` varchar(66) DEFAULT NULL,
  `transactionId` varchar(255) DEFAULT NULL,
  `idempotencyKey` varchar(128) NOT NULL,
  `requestIp` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_abf2669cb365ae019f32283f30` (`ref`),
  UNIQUE KEY `uq_wd_idem` (`idempotencyKey`),
  KEY `idx_wd_status` (`status`),
  KEY `idx_wd_user_time` (`userId`,`createdAt`),
  KEY `idx_wd_created_status` (`createdAt`,`status`),
  KEY `idx_wd_review_created` (`reviewRequired`,`createdAt`),
  KEY `fk_wd_tx` (`transactionId`),
  CONSTRAINT `fk_wd_tx` FOREIGN KEY (`transactionId`) REFERENCES `transactions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_wd_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `withdrawals`
--

LOCK TABLES `withdrawals` WRITE;
/*!40000 ALTER TABLE `withdrawals` DISABLE KEYS */;
/*!40000 ALTER TABLE `withdrawals` ENABLE KEYS */;
UNLOCK TABLES;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 */ /*!50003 TRIGGER `trg_withdrawal_amount_positive` BEFORE INSERT ON `withdrawals` FOR EACH ROW BEGIN
        IF NEW.amountMtt <= 0 THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AMOUNT_INVALID: amountMtt must be positive.';
        END IF;
      END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;

--
-- Dumping routines for database 'members_trail'
--
/*!50003 DROP FUNCTION IF EXISTS `fn_month_key` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE FUNCTION `fn_month_key`(p_at DATETIME(6)) RETURNS char(7) CHARSET utf8mb4
    DETERMINISTIC
    SQL SECURITY INVOKER
BEGIN
        RETURN DATE_FORMAT(CONVERT_TZ(p_at, @@session.time_zone, '+00:00'), '%Y-%m');
      END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sp_bump_risk_scores` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_bump_risk_scores`(
        IN  p_user_ids JSON,
        IN  p_score    INT
      )
    MODIFIES SQL DATA
    SQL SECURITY INVOKER
BEGIN
        DECLARE v_i INT DEFAULT 0;
        DECLARE v_id VARCHAR(36);
        DECLARE v_total INT DEFAULT 0;

        /* Looped for the same reason as sp_mark_notifications_read: a JSON_TABLE join
         * against an id column depends on the server's default character set matching
         * the schema's. Each iteration is one indexed UPDATE on the primary key. */
        WHILE v_i < JSON_LENGTH(p_user_ids) DO
          SET v_id = JSON_UNQUOTE(JSON_EXTRACT(p_user_ids, CONCAT('$[', v_i, ']')));

          UPDATE users
             SET riskScore = LEAST(100, GREATEST(riskScore, p_score)), updatedAt = NOW(6)
           WHERE id = v_id AND riskScore < p_score;

          SET v_total = v_total + ROW_COUNT();
          SET v_i = v_i + 1;
        END WHILE;

        SELECT v_total AS affected;
      END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sp_expire_stale_approvals` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_expire_stale_approvals`()
    MODIFIES SQL DATA
    SQL SECURITY INVOKER
BEGIN
        UPDATE approval_requests
           SET status = 'expired', decisionNote = 'Expired unanswered', updatedAt = NOW(6)
         WHERE status = 'pending' AND expiresAt <= NOW(6);
        SELECT ROW_COUNT() AS affected;
      END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sp_expire_stale_listings` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_expire_stale_listings`(IN p_cutoff DATETIME(6))
    MODIFIES SQL DATA
    SQL SECURITY INVOKER
BEGIN
        START TRANSACTION;

        UPDATE user_inventory inv
           JOIN market_listings l ON l.inventoryItemId = inv.id
           SET inv.lockedByListingId = NULL, inv.updatedAt = NOW(6)
         WHERE l.status = 'active' AND l.createdAt < p_cutoff
           AND inv.lockedByListingId = l.id;

        UPDATE market_listings
           SET status = 'expired', updatedAt = NOW(6)
         WHERE status = 'active' AND createdAt < p_cutoff;

        SELECT ROW_COUNT() AS affected;
        COMMIT;
      END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sp_leaderboard_snapshot_upsert` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_leaderboard_snapshot_upsert`(
        IN  p_metric     VARCHAR(32),
        IN  p_period_key VARCHAR(16),
        IN  p_rows       JSON
      )
    MODIFIES SQL DATA
    SQL SECURITY INVOKER
BEGIN
        INSERT INTO leaderboard_snapshots (id, createdAt, updatedAt, metric, periodKey, userId, score, `rank`)
        SELECT UUID(), NOW(6), NOW(6), p_metric, p_period_key, j.userId, j.score, j.rank
        FROM JSON_TABLE(
          p_rows, '$[*]' COLUMNS (
            userId VARCHAR(255) PATH '$.userId',
            score  BIGINT       PATH '$.score',
            `rank` INT          PATH '$.rank'
          )
        ) AS j
        ON DUPLICATE KEY UPDATE
          score     = VALUES(score),
          `rank`    = VALUES(`rank`),
          updatedAt = NOW(6);

        /* Rows SUBMITTED, not ROW_COUNT(): MySQL counts an ON DUPLICATE KEY update as
         * two rows affected, so ROW_COUNT() here reads as double the board size and
         * makes the cron log nonsense. */
        SELECT JSON_LENGTH(p_rows) AS affected;
      END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sp_mark_all_notifications_read` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_mark_all_notifications_read`(IN  p_user_id  VARCHAR(255))
    MODIFIES SQL DATA
    SQL SECURITY INVOKER
BEGIN
        UPDATE notifications
           SET `read` = 1, readAt = NOW(6), updatedAt = NOW(6)
         WHERE userId = p_user_id AND `read` = 0;
        SELECT ROW_COUNT() AS affected;
      END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sp_mark_chain_events_orphaned` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_mark_chain_events_orphaned`(
        IN  p_contract   VARCHAR(60),
        IN  p_from_block BIGINT
      )
    MODIFIES SQL DATA
    SQL SECURITY INVOKER
BEGIN
        /* Counted before the write: how many of the orphaned events had already been
         * applied to balances is the number an operator needs, and it is unavailable
         * afterwards. */
        SELECT COUNT(*) INTO @processed
          FROM chain_events
         WHERE contractName = p_contract AND blockNumber > p_from_block
           AND orphaned = 0 AND processedAt IS NOT NULL;

        UPDATE chain_events
           SET orphaned = 1, updatedAt = NOW(6)
         WHERE contractName = p_contract AND blockNumber > p_from_block AND orphaned = 0;

        SELECT ROW_COUNT() AS affected, @processed AS processedBeforeRewind;
      END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sp_mark_notifications_read` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_mark_notifications_read`(
        IN  p_user_id  VARCHAR(255),
        IN  p_ids      JSON
      )
    MODIFIES SQL DATA
    SQL SECURITY INVOKER
BEGIN
        DECLARE v_i INT DEFAULT 0;
        DECLARE v_id VARCHAR(36);
        DECLARE v_total INT DEFAULT 0;

        /* A loop over the ids rather than a JOIN against JSON_TABLE.
         *
         * JSON_TABLE gives its columns the SERVER's default character set, not the
         * table's — so joining one against an id column raises "illegal mix of
         * collations" on any server whose default differs from the schema's. That
         * depends on how the server was installed, which means the JOIN form works on
         * one machine and fails on the next. A routine variable takes the routine's own
         * character set and compares cleanly with either.
         *
         * Each iteration is a single-row indexed UPDATE, and the whole loop is still
         * ONE round trip from the application — which is the round trip that mattered. */
        WHILE v_i < JSON_LENGTH(p_ids) DO
          SET v_id = JSON_UNQUOTE(JSON_EXTRACT(p_ids, CONCAT('$[', v_i, ']')));

          UPDATE notifications
             SET `read` = 1, readAt = NOW(6), updatedAt = NOW(6)
           /* Scoped to the owner: an id from another member's inbox must not match. */
           WHERE id = v_id AND userId = p_user_id AND `read` = 0;

          SET v_total = v_total + ROW_COUNT();
          SET v_i = v_i + 1;
        END WHILE;

        SELECT v_total AS affected;
      END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sp_prune_read_notifications` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_prune_read_notifications`(
        IN  p_cutoff   DATETIME(6),
        IN  p_limit    INT
      )
    MODIFIES SQL DATA
    SQL SECURITY INVOKER
BEGIN
        DELETE FROM notifications
         WHERE `read` = 1 AND readAt IS NOT NULL AND readAt < p_cutoff
         ORDER BY readAt ASC
         LIMIT p_limit;
        SELECT ROW_COUNT() AS affected;
      END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sp_quest_progress` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_quest_progress`(
        IN  p_user_id    VARCHAR(255),
        IN  p_quest_id   VARCHAR(255),
        IN  p_period_key VARCHAR(16),
        IN  p_amount     INT,
        IN  p_target     INT,
        IN  p_expires_at DATETIME(6)
      )
    MODIFIES SQL DATA
    SQL SECURITY INVOKER
BEGIN
        DECLARE v_was_complete TINYINT DEFAULT 0;

        SELECT CASE WHEN completedAt IS NULL THEN 0 ELSE 1 END INTO v_was_complete
        FROM user_quests
        WHERE userId = p_user_id AND questId = p_quest_id AND periodKey = p_period_key;

        INSERT INTO user_quests
          (id, createdAt, updatedAt, userId, questId, periodKey, progress, pointsAwarded, expiresAt, completedAt)
        VALUES
          (UUID(), NOW(6), NOW(6), p_user_id, p_quest_id, p_period_key,
           LEAST(p_amount, p_target), 0, p_expires_at,
           CASE WHEN LEAST(p_amount, p_target) >= p_target THEN NOW(6) ELSE NULL END)
        ON DUPLICATE KEY UPDATE
          progress    = LEAST(p_target, progress + p_amount),
          /* Already-completed instances keep their original timestamp: a quest is
           * completed once, and further play must not re-stamp it. */
          completedAt = CASE
                          WHEN completedAt IS NOT NULL THEN completedAt
                          WHEN LEAST(p_target, progress + p_amount) >= p_target THEN NOW(6)
                          ELSE NULL
                        END,
          updatedAt   = NOW(6);

        /* `completed` means COMPLETED BY THIS CALL, not "is complete" — the caller
         * publishes an event on the transition, and a quest that was already finished
         * must not fire it again on every later signal. */
        SELECT
          progress                                                                   AS progress,
          CASE WHEN completedAt IS NOT NULL AND v_was_complete = 0 THEN 1 ELSE 0 END  AS completed,
          CASE WHEN completedAt IS NULL THEN 0 ELSE 1 END                            AS isComplete
        FROM user_quests
        WHERE userId = p_user_id AND questId = p_quest_id AND periodKey = p_period_key;
      END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sp_reset_chain_events_for_replay` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_general_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_reset_chain_events_for_replay`(
        IN  p_from     BIGINT,
        IN  p_to       BIGINT
      )
    MODIFIES SQL DATA
    SQL SECURITY INVOKER
BEGIN
        UPDATE chain_events
           SET processedAt = NULL, processAttempts = 0, processError = NULL, updatedAt = NOW(6)
         WHERE blockNumber BETWEEN p_from AND p_to AND orphaned = 0;
        SELECT ROW_COUNT() AS affected;
      END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;

--
-- Final view structure for view `v_admin_kpis`
--

/*!50001 DROP VIEW IF EXISTS `v_admin_kpis`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_general_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY INVOKER */
/*!50001 VIEW `v_admin_kpis` AS select (select count(0) from `users` where (`users`.`status` <> 'closed')) AS `members`,(select count(0) from `users` where (`users`.`lastActiveAt` >= (now() - interval 30 day))) AS `activeMembers30d`,(select count(0) from `users` where (`users`.`kycTier` in (1,2))) AS `kycVerified`,(select count(0) from `users` where (`users`.`status` = 'frozen')) AS `frozenAccounts`,(select count(0) from `withdrawals` where (`withdrawals`.`status` = 'review')) AS `withdrawalsInReview`,(select count(0) from `fraud_alerts` where (`fraud_alerts`.`status` in ('open','investigating'))) AS `openFraudAlerts`,(select count(0) from `approval_requests` where (`approval_requests`.`status` = 'pending')) AS `pendingApprovals`,(select count(0) from `tickets` where ((`tickets`.`firstResponseAt` is null) and (`tickets`.`slaDueAt` < now()) and (`tickets`.`status` not in ('resolved','closed')))) AS `breachedTickets`,(select coalesce(sum(`commissions`.`amountMtt`),0) from `commissions` where (`commissions`.`status` = 'queued')) AS `queuedCommissionMtt` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_commission_solvency`
--

/*!50001 DROP VIEW IF EXISTS `v_commission_solvency`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_general_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY INVOKER */
/*!50001 VIEW `v_commission_solvency` AS select (select coalesce(sum(`o`.`amount`),0) from `treasury_outflows` `o` where ((`o`.`destination` = 'commission_pool') and (`o`.`status` = 'confirmed'))) AS `poolFundedMtt`,(select coalesce(sum(`c`.`amountMtt`),0) from `commissions` `c` where (`c`.`status` in ('released','claimed'))) AS `committedMtt`,(select coalesce(sum(`c`.`amountMtt`),0) from `commissions` `c` where (`c`.`status` = 'queued')) AS `queuedMtt`,(select coalesce(sum(`c`.`amountMtt`),0) from `commissions` `c` where (`c`.`status` = 'pending_kyc')) AS `pendingKycMtt` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_conversion_monthly`
--

/*!50001 DROP VIEW IF EXISTS `v_conversion_monthly`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_general_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY INVOKER */
/*!50001 VIEW `v_conversion_monthly` AS select date_format(`conversions`.`createdAt`,'%Y-%m') AS `periodKey`,`conversions`.`rateApplied` AS `rateApplied`,count(0) AS `conversions`,coalesce(sum(`conversions`.`pointsSpent`),0) AS `pointsSpent`,coalesce(sum(`conversions`.`mttCredited`),0) AS `mttCredited` from `conversions` where (`conversions`.`status` = 'completed') group by date_format(`conversions`.`createdAt`,'%Y-%m'),`conversions`.`rateApplied` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_member_signup_cohort`
--

/*!50001 DROP VIEW IF EXISTS `v_member_signup_cohort`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_general_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY INVOKER */
/*!50001 VIEW `v_member_signup_cohort` AS select date_format(`users`.`createdAt`,'%Y-%m') AS `periodKey`,count(0) AS `signups`,sum((case when (`users`.`kycTier` > 0) then 1 else 0 end)) AS `verified`,sum((case when (`users`.`referredById` is not null) then 1 else 0 end)) AS `referred`,sum((case when (`users`.`status` = 'closed') then 1 else 0 end)) AS `closed` from `users` group by date_format(`users`.`createdAt`,'%Y-%m') */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_mtt_liability`
--

/*!50001 DROP VIEW IF EXISTS `v_mtt_liability`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_general_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY INVOKER */
/*!50001 VIEW `v_mtt_liability` AS select count(0) AS `accounts`,coalesce(sum(`user_balances`.`mttAvailable`),0) AS `availableMtt`,coalesce(sum(`user_balances`.`mttStaked`),0) AS `stakedMtt`,coalesce(sum(`user_balances`.`mttPendingRewards`),0) AS `pendingRewardsMtt`,coalesce(sum(`user_balances`.`mttLockedForWithdrawal`),0) AS `lockedForWithdrawalMtt`,coalesce(sum(`user_balances`.`commissionAvailable`),0) AS `commissionAvailableMtt`,coalesce(sum(`user_balances`.`commissionPending`),0) AS `commissionPendingMtt`,coalesce(sum((((((`user_balances`.`mttAvailable` + `user_balances`.`mttStaked`) + `user_balances`.`mttPendingRewards`) + `user_balances`.`mttLockedForWithdrawal`) + `user_balances`.`commissionAvailable`) + `user_balances`.`commissionPending`)),0) AS `totalLiabilityMtt`,coalesce(sum(`user_balances`.`points`),0) AS `totalPoints` from `user_balances` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_payout_ratio`
--

/*!50001 DROP VIEW IF EXISTS `v_payout_ratio`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_general_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY INVOKER */
/*!50001 VIEW `v_payout_ratio` AS select `k`.`periodKey` AS `periodKey`,coalesce(`r`.`reconciledNetRevenue`,0) AS `reconciledNetRevenue`,coalesce(`c`.`releasedCommission`,0) AS `releasedCommission`,coalesce(`o`.`confirmedOutflow`,0) AS `confirmedOutflow`,coalesce(`i`.`reconciledInflow`,0) AS `reconciledTreasuryInflow`,(case when (coalesce(`r`.`reconciledNetRevenue`,0) = 0) then NULL else floor(((coalesce(`c`.`releasedCommission`,0) / `r`.`reconciledNetRevenue`) * 10000)) end) AS `commissionRatioBps`,(case when (coalesce(`i`.`reconciledInflow`,0) = 0) then NULL else floor(((coalesce(`o`.`confirmedOutflow`,0) / `i`.`reconciledInflow`) * 10000)) end) AS `outflowRatioBps` from (((((select date_format(`revenue_events`.`occurredAt`,'%Y-%m') AS `periodKey` from `revenue_events` union select `commissions`.`monthKey` AS `monthKey` from `commissions` union select `treasury_outflows`.`periodKey` AS `periodKey` from `treasury_outflows` union select `treasury_inflows`.`periodKey` AS `periodKey` from `treasury_inflows`) `k` left join (select date_format(`revenue_events`.`occurredAt`,'%Y-%m') AS `periodKey`,sum(`revenue_events`.`netAmount`) AS `reconciledNetRevenue` from `revenue_events` where ((`revenue_events`.`reconciled` = 1) and (`revenue_events`.`reversedAt` is null)) group by date_format(`revenue_events`.`occurredAt`,'%Y-%m')) `r` on((`r`.`periodKey` = `k`.`periodKey`))) left join (select `commissions`.`monthKey` AS `periodKey`,sum(`commissions`.`amount`) AS `releasedCommission` from `commissions` where (`commissions`.`status` in ('released','claimed')) group by `commissions`.`monthKey`) `c` on((`c`.`periodKey` = `k`.`periodKey`))) left join (select `treasury_outflows`.`periodKey` AS `periodKey`,sum(`treasury_outflows`.`amount`) AS `confirmedOutflow` from `treasury_outflows` where (`treasury_outflows`.`status` = 'confirmed') group by `treasury_outflows`.`periodKey`) `o` on((`o`.`periodKey` = `k`.`periodKey`))) left join (select `treasury_inflows`.`periodKey` AS `periodKey`,sum(`treasury_inflows`.`amountMtt`) AS `reconciledInflow` from `treasury_inflows` where (`treasury_inflows`.`reconciled` = 1) group by `treasury_inflows`.`periodKey`) `i` on((`i`.`periodKey` = `k`.`periodKey`))) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_points_drift`
--

/*!50001 DROP VIEW IF EXISTS `v_points_drift`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_general_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY INVOKER */
/*!50001 VIEW `v_points_drift` AS select `b`.`userId` AS `userId`,`b`.`points` AS `balancePoints`,coalesce(`l`.`ledgerSum`,0) AS `ledgerPoints`,(`b`.`points` - coalesce(`l`.`ledgerSum`,0)) AS `drift` from (`user_balances` `b` left join (select `points_ledger`.`userId` AS `userId`,sum(`points_ledger`.`amount`) AS `ledgerSum` from `points_ledger` group by `points_ledger`.`userId`) `l` on((`l`.`userId` = `b`.`userId`))) where (`b`.`points` <> coalesce(`l`.`ledgerSum`,0)) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_treasury_period`
--

/*!50001 DROP VIEW IF EXISTS `v_treasury_period`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_general_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 SQL SECURITY INVOKER */
/*!50001 VIEW `v_treasury_period` AS select `p`.`periodKey` AS `periodKey`,coalesce(`i`.`reconciledInflow`,0) AS `reconciledInflow`,coalesce(`i`.`unreconciledInflow`,0) AS `unreconciledInflow`,coalesce(`i`.`grossRevenue`,0) AS `grossRevenue`,coalesce(`o`.`commissionPoolOut`,0) AS `commissionPoolOut`,coalesce(`o`.`stakingPoolOut`,0) AS `stakingPoolOut`,coalesce(`o`.`reserveOut`,0) AS `reserveOut`,coalesce(`i`.`inflowCount`,0) AS `inflowCount`,coalesce(`o`.`outflowCount`,0) AS `outflowCount` from (((select `treasury_inflows`.`periodKey` AS `periodKey` from `treasury_inflows` union select `treasury_outflows`.`periodKey` AS `periodKey` from `treasury_outflows` union select `treasury_periods`.`periodKey` AS `periodKey` from `treasury_periods`) `p` left join (select `treasury_inflows`.`periodKey` AS `periodKey`,sum((case when (`treasury_inflows`.`reconciled` = 1) then `treasury_inflows`.`amountMtt` else 0 end)) AS `reconciledInflow`,sum((case when (`treasury_inflows`.`reconciled` = 0) then `treasury_inflows`.`amountMtt` else 0 end)) AS `unreconciledInflow`,sum(`treasury_inflows`.`grossRevenue`) AS `grossRevenue`,count(0) AS `inflowCount` from `treasury_inflows` group by `treasury_inflows`.`periodKey`) `i` on((`i`.`periodKey` = `p`.`periodKey`))) left join (select `treasury_outflows`.`periodKey` AS `periodKey`,sum((case when ((`treasury_outflows`.`destination` = 'commission_pool') and (`treasury_outflows`.`status` = 'confirmed')) then `treasury_outflows`.`amount` else 0 end)) AS `commissionPoolOut`,sum((case when ((`treasury_outflows`.`destination` = 'staking_pool') and (`treasury_outflows`.`status` = 'confirmed')) then `treasury_outflows`.`amount` else 0 end)) AS `stakingPoolOut`,sum((case when ((`treasury_outflows`.`fromReserve` = 1) and (`treasury_outflows`.`status` = 'confirmed')) then `treasury_outflows`.`amount` else 0 end)) AS `reserveOut`,count(0) AS `outflowCount` from `treasury_outflows` group by `treasury_outflows`.`periodKey`) `o` on((`o`.`periodKey` = `p`.`periodKey`))) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-08-24  9:12:30
